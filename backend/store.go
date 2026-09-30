package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type configStore struct {
	path string
	mu   sync.Mutex
}

func newConfigStore(dir string) (*configStore, error) {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("Equalizer APO config directory does not exist: %s; use -config-dir to select it", dir)
	}
	path, err := filepath.Abs(filepath.Join(dir, "peqstudio.txt"))
	if err != nil {
		return nil, err
	}
	s := &configStore{path: path}
	if _, err := s.readManaged(); err == nil {
		return s, nil // Preserve the last applied configuration across console restarts.
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	empty := channel{Filters: []filter{}}
	data, _ := (configuration{Version: 1, Name: "Waiting for the editor", SampleRate: 48000, Linked: true, Left: empty}).render()
	// Exclusive creation protects an existing file, even during concurrent startup.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return nil, fmt.Errorf("create %s: %w; grant write access to the config directory", path, err)
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		return nil, writeErr
	}
	return s, closeErr
}

func (s *configStore) readManaged() ([]byte, error) {
	var data []byte
	err := retryFileAccess(func() error {
		var err error
		data, err = s.readManagedOnce()
		return err
	})
	return data, err
}

func (s *configStore) readManagedOnce() ([]byte, error) {
	info, err := os.Lstat(s.path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("refusing to overwrite non-regular file %s", s.path)
	}
	data, err := os.ReadFile(s.path)
	if err == nil && !bytes.HasPrefix(data, []byte(managedHeader+"\r\n")) && !bytes.HasPrefix(data, []byte(managedHeader+"\n")) {
		return nil, fmt.Errorf("%s is not managed by PEQ Studio; rename it before starting the backend", s.path)
	}
	return data, err
}

func (s *configStore) apply(c configuration) error {
	data, err := c.render()
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, err := s.readManaged()
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read managed configuration %s: %w", s.path, err)
	}
	if bytes.Equal(previous, data) {
		return nil
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".peqstudio-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary configuration in %s: %w", filepath.Dir(s.path), err)
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	closeErr := f.Close()
	if err != nil {
		return fmt.Errorf("write temporary configuration: %w", err)
	}
	if closeErr != nil {
		return fmt.Errorf("close temporary configuration: %w", closeErr)
	}
	if err := retryFileAccess(func() error { return replaceFile(f.Name(), s.path) }); err != nil {
		return fmt.Errorf("replace managed configuration %s: %w", s.path, err)
	}
	return nil
}
