package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
)

func newHandler(store *configStore, staticDir string, extraOrigins ...string) http.Handler {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(err)
	}
	token := hex.EncodeToString(secret)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"backend": "equalizer-apo", "version": 1, "configPath": store.path,
			"include": "Include: peqstudio.txt", "token": token,
		})
	})
	mux.HandleFunc("PUT /api/config", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-PEQ-Token") != token {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Backend restarted; reconnect and try again."})
			return
		}
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Expected application/json."})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var c configuration
		if err := decoder.Decode(&c); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid configuration: " + err.Error()})
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Expected exactly one configuration."})
			return
		}
		if _, err := c.render(); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := store.apply(c); err != nil {
			var busy *configBusyError
			if errors.As(err, &busy) {
				// The client keeps its session and retries its newest edit promptly.
				// Only a confirmed replacement is acknowledged as synced.
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{
					"code": "config_busy", "retryAfterMs": 50,
					"error": "peqstudio.txt is locked or not writable. Close other configuration editors or check write/delete permissions if this persists.",
				})
				return
			}
			log.Printf("Config update failed: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not write peqstudio.txt. Check directory permissions and console output."})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"configPath": store.path})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Unknown API endpoint."})
	})
	mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		// The listener remains local even when the frontend is hosted on GitHub Pages.
		// Reject DNS rebinding before considering the frontend origin.
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			http.Error(w, "Local requests only", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if !allowAPIRequest(w, r, extraOrigins) {
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
