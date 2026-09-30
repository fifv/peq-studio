package main

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func exampleConfig() configuration {
	return configuration{
		Version: 1, Name: "Test", Enabled: true, Linked: true, SampleRate: 48000,
		Left: channel{PreampDb: -5.5, Filters: []filter{
			{Type: "PK", Enabled: true, FcHz: 1000, GainDb: 3.2, Q: 1.5},
			{Type: "LSC", Enabled: false, FcHz: 80, GainDb: 4, Q: 0.7},
			{Type: "HSC", Enabled: true, FcHz: 8000, GainDb: -2, Q: 0.8},
			{Type: "LP", Enabled: true, FcHz: 15000, GainDb: 0, Q: 2},
			{Type: "HP", Enabled: true, FcHz: 30, GainDb: 0, Q: 0.5},
		}},
		Right: channel{PreampDb: -2, Filters: []filter{}},
	}
}

func TestRenderFiltersAndChannels(t *testing.T) {
	c := exampleConfig()
	data, err := c.render()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Channel: L R\r\nPreamp: -5.5 dB", "Filter 1: ON PK Fc 1000 Hz Gain 3.2 dB Q 1.5",
		"Filter 2: OFF LSC Fc 80 Hz Gain 4 dB Q 0.7", "Filter 3: ON HSC Fc 8000 Hz Gain -2 dB Q 0.8",
		"Filter 4: ON LPQ Fc 15000 Hz Q 2", "Filter 5: ON HPQ Fc 30 Hz Q 0.5",
	} {
		if !strings.Contains(string(data), want) {
			t.Errorf("missing %q in %s", want, data)
		}
	}
	if !strings.HasSuffix(string(data), "Channel: ALL\r\n") || bytes.Contains(data, []byte("Preamp: -2")) {
		t.Fatal("linked channels or channel reset incorrect")
	}
	c.Linked = false
	data, _ = c.render()
	if !bytes.Contains(data, []byte("Channel: L\r\n")) || !bytes.Contains(data, []byte("Channel: R\r\nPreamp: -2 dB")) {
		t.Fatalf("split output incorrect: %s", data)
	}
	c.Enabled = false
	data, _ = c.render()
	if bytes.Contains(data, []byte("Preamp:")) || bytes.Contains(data, []byte("Filter 1:")) {
		t.Fatal("bypass must omit preamp and filters")
	}
}

func TestComparisonBypassesFiltersButKeepsBothPreamps(t *testing.T) {
	c := exampleConfig()
	c.Linked = false
	filtersEnabled := false
	c.FiltersEnabled = &filtersEnabled
	data, err := c.render()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Channel: L\r\nPreamp: -5.5 dB", "Channel: R\r\nPreamp: -2 dB"} {
		if !bytes.Contains(data, []byte(want)) {
			t.Fatalf("comparison lost channel preamp: %s", data)
		}
	}
	if bytes.Contains(data, []byte("Filter 1:")) || len(c.Left.Filters) != 5 {
		t.Fatal("comparison must skip filters without changing stored bands")
	}
	filtersEnabled = true
	data, _ = c.render()
	if !bytes.Contains(data, []byte("Filter 1: ON PK")) {
		t.Fatal("returning to A must restore filters")
	}
	filtersEnabled = false
	c.Enabled = false
	data, _ = c.render()
	if bytes.Contains(data, []byte("Preamp:")) || bytes.Contains(data, []byte("Filter 1:")) {
		t.Fatal("master power must still bypass all processing")
	}
}

func TestCORSForPagesAndLocalFrontends(t *testing.T) {
	s, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newHandler(s, t.TempDir(), "https://peq.example.com")
	for _, origin := range []string{pagesOrigin, "http://localhost:5173", "http://127.0.0.1:4173", "http://[::1]:5173", "https://peq.example.com"} {
		t.Run(origin, func(t *testing.T) {
			for _, method := range []string{"GET", "PUT"} {
				r := httptest.NewRequest("OPTIONS", "http://127.0.0.1:8765/api/config", nil)
				r.Header.Set("Origin", origin)
				r.Header.Set("Access-Control-Request-Method", method)
				r.Header.Set("Access-Control-Request-Headers", "content-type,x-peq-token")
				r.Header.Set("Access-Control-Request-Private-Network", "true")
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != origin || w.Header().Get("Access-Control-Allow-Private-Network") != "true" {
					t.Fatalf("preflight failed: %d %v", w.Code, w.Header())
				}
			}
			r := httptest.NewRequest("GET", "http://127.0.0.1:8765/api/status", nil)
			r.Header.Set("Origin", origin)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			var info struct{ Token string }
			if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil || info.Token == "" || w.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("status inaccessible from %s", origin)
			}
			body, _ := json.Marshal(exampleConfig())
			r = httptest.NewRequest("PUT", "http://127.0.0.1:8765/api/config", bytes.NewReader(body))
			r.Header.Set("Origin", origin)
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-PEQ-Token", info.Token)
			w = httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("write failed from %s: %d", origin, w.Code)
			}
		})
	}
	for _, origin := range []string{"null", "https://evil.example", "https://other.github.io", "https://fifv.github.io.evil.example", "https://fifv.github.io/peq-studio", "http://192.168.1.1", "http://localhost.evil.example"} {
		for _, method := range []string{"OPTIONS", "GET", "PUT"} {
			r := httptest.NewRequest(method, "http://127.0.0.1:8765/api/status", nil)
			r.Header.Set("Origin", origin)
			r.Header.Set("Access-Control-Request-Method", "PUT")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" || strings.Contains(w.Body.String(), `"token"`) {
				t.Fatalf("untrusted origin accepted: %s %s", origin, method)
			}
		}
	}
}

func TestValidationAndNameInjection(t *testing.T) {
	for _, mutate := range []func(*configuration){
		func(c *configuration) { c.Version = 2 },
		func(c *configuration) { c.SampleRate = 1234 },
		func(c *configuration) { c.Left.PreampDb = math.Inf(1) },
		func(c *configuration) { c.Left.Filters = nil },
		func(c *configuration) { c.Left.Filters[0].Type = "NO" },
		func(c *configuration) { c.Left.Filters[0].FcHz = 0 },
		func(c *configuration) { c.Left.Filters[0].Q = 21 },
		func(c *configuration) { c.Left.Filters[0].GainDb = math.NaN() },
		func(c *configuration) { c.Linked = false; c.Right.PreampDb = math.NaN() },
	} {
		c := exampleConfig()
		mutate(&c)
		if _, err := c.render(); err == nil {
			t.Fatal("invalid configuration accepted")
		}
	}
	c := exampleConfig()
	c.Name = "Evil\r\nInclude: other.txt"
	data, _ := c.render()
	if strings.Contains(string(data), "\nInclude: other.txt") {
		t.Fatal("preset name injected an APO command")
	}
}

func TestStorePreservesParentAndRestartAndRejectsForeignFile(t *testing.T) {
	dir := t.TempDir()
	parent := filepath.Join(dir, "config.txt")
	original := []byte("# user's config\r\nInclude: other.txt\r\n")
	if err := os.WriteFile(parent, original, 0644); err != nil {
		t.Fatal(err)
	}
	s, err := newConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	initial, _ := os.ReadFile(s.path)
	if bytes.Contains(initial, []byte("Preamp:")) {
		t.Fatal("initial file should bypass audio")
	}
	if err := s.apply(exampleConfig()); err != nil {
		t.Fatal(err)
	}
	written, _ := os.ReadFile(s.path)
	if _, err := newConfigStore(dir); err != nil {
		t.Fatal(err)
	}
	restarted, _ := os.ReadFile(s.path)
	if !bytes.Equal(written, restarted) {
		t.Fatal("restart changed the saved EQ")
	}
	bad := exampleConfig()
	bad.Left.Filters[0].Q = 0
	if err := s.apply(bad); err == nil {
		t.Fatal("invalid apply should fail")
	}
	afterBad, _ := os.ReadFile(s.path)
	if !bytes.Equal(written, afterBad) {
		t.Fatal("failed apply changed file")
	}
	actual, _ := os.ReadFile(parent)
	if !bytes.Equal(original, actual) {
		t.Fatal("parent configuration changed")
	}
	if err := os.WriteFile(s.path, []byte("# user owned"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := newConfigStore(dir); err == nil {
		t.Fatal("startup should refuse unmanaged file")
	}
	if err := s.apply(exampleConfig()); err == nil {
		t.Fatal("apply should refuse unmanaged replacement")
	}
	files, _ := filepath.Glob(filepath.Join(dir, ".peqstudio-*.tmp"))
	if len(files) != 0 {
		t.Fatal("temporary file left behind")
	}
}

func TestHTTPAuthenticationValidationAndWrites(t *testing.T) {
	s, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newHandler(s, t.TempDir())
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-PEQ-Token", token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	status := request("GET", "/api/status", "", "")
	var info struct{ Token, ConfigPath string }
	if err := json.Unmarshal(status.Body.Bytes(), &info); err != nil || status.Code != 200 || info.Token == "" || info.ConfigPath != s.path {
		t.Fatalf("invalid status: %s", status.Body)
	}
	body, _ := json.Marshal(exampleConfig())
	for _, token := range []string{"", "wrong"} {
		if got := request("PUT", "/api/config", token, string(body)).Code; got != 403 {
			t.Fatalf("unauthorized request returned %d", got)
		}
	}
	for _, invalid := range []string{"{}", string(body) + " {}", strings.Replace(string(body), `"version":1`, `"version":2`, 1), strings.Replace(string(body), `"q":1.5`, `"q":null`, 1)} {
		if got := request("PUT", "/api/config", info.Token, invalid).Code; got != 400 {
			t.Fatalf("invalid request returned %d: %s", got, invalid)
		}
	}
	if result := request("PUT", "/api/config", info.Token, string(body)); result.Code != 200 {
		t.Fatalf("apply failed: %s", result.Body)
	}
	want, _ := exampleConfig().render()
	actual, _ := os.ReadFile(s.path)
	if !bytes.Equal(want, actual) {
		t.Fatalf("unexpected file: %s", actual)
	}
	r := httptest.NewRequest("GET", "http://attacker.example/api/status", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatal("DNS rebinding hostname accepted")
	}
	if status.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("status must not expose token through CORS")
	}
}
