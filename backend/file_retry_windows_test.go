package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func holdConfig(t *testing.T, path string, share uint32) syscall.Handle {
	t.Helper()
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ, share, nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestWindowsReplacementRecoversFromReaderWithoutDeleteSharing(t *testing.T) {
	s, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := holdConfig(t, s.path, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE)
	defer func() {
		if h != syscall.InvalidHandle {
			syscall.CloseHandle(h)
		}
	}()
	// Reproduce the failure of the old one-shot MoveFileEx path on a real handle.
	source := filepath.Join(filepath.Dir(s.path), "replacement.tmp")
	if err := os.WriteFile(source, []byte("unused"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(source, s.path); err == nil || !transientFileError(err) {
		t.Fatalf("expected a Windows sharing/access error, got %v", err)
	} else {
		t.Logf("Reproduced one-shot replacement error: %v", err)
	}
	released := make(chan struct{})
	go func() {
		time.Sleep(60 * time.Millisecond)
		syscall.CloseHandle(h)
		close(released)
	}()
	start := time.Now()
	err = s.apply(exampleConfig())
	<-released
	h = syscall.InvalidHandle
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed >= time.Second {
		t.Fatalf("brief lock took too long: %s", elapsed)
	} else {
		t.Logf("Recovered and applied in %s", elapsed)
	}
	want, _ := exampleConfig().render()
	got, err := os.ReadFile(s.path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("replacement was not complete: %v", err)
	}
}

func TestWindowsBusyHTTPPreservesFileAndSession(t *testing.T) {
	s, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	original, _ := os.ReadFile(s.path)
	handler := newHandler(s, t.TempDir())
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest("GET", "http://127.0.0.1:8765/api/status", nil))
	var info struct{ Token string }
	if err := json.Unmarshal(status.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	h := holdConfig(t, s.path, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE)
	defer func() {
		if h != syscall.InvalidHandle {
			syscall.CloseHandle(h)
		}
	}()
	body, _ := json.Marshal(exampleConfig())
	apply := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("PUT", "http://127.0.0.1:8765/api/config", bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-PEQ-Token", info.Token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	w := apply()
	var failure struct {
		Code         string
		RetryAfterMs int
	}
	if err := json.Unmarshal(w.Body.Bytes(), &failure); err != nil || w.Code != 503 || failure.Code != "config_busy" || failure.RetryAfterMs != 50 {
		t.Fatalf("unexpected busy response: %d %s", w.Code, w.Body)
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(original, after) {
		t.Fatal("locked update changed the original file")
	}
	files, _ := filepath.Glob(filepath.Join(filepath.Dir(s.path), ".peqstudio-*.tmp"))
	if len(files) != 0 {
		t.Fatal("failed update leaked a temporary file")
	}
	syscall.CloseHandle(h)
	h = syscall.InvalidHandle
	if w := apply(); w.Code != 200 {
		t.Fatalf("same session did not recover: %d %s", w.Code, w.Body)
	}
}

func TestWindowsReadRecoversFromExclusiveReader(t *testing.T) {
	s, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := holdConfig(t, s.path, 0)
	released := make(chan struct{})
	go func() {
		time.Sleep(30 * time.Millisecond)
		syscall.CloseHandle(h)
		close(released)
	}()
	err = s.apply(exampleConfig())
	<-released
	if err != nil {
		t.Fatal(err)
	}
}

func TestWindowsRetryClassifiesAccessErrorsOnly(t *testing.T) {
	for _, code := range []syscall.Errno{5, 32, 33} {
		attempts := 0
		err := retryFileAccess(func() error {
			attempts++
			if attempts < 3 {
				return &os.PathError{Op: "replace", Path: "peqstudio.txt", Err: code}
			}
			return nil
		})
		if err != nil || attempts != 3 {
			t.Fatalf("did not recover from %v: %v", code, err)
		}
	}
	want := errors.New("not a file lock")
	attempts := 0
	err := retryFileAccess(func() error { attempts++; return want })
	if !errors.Is(err, want) || attempts != 1 {
		t.Fatal("unexpected retry of a permanent error")
	}
}
