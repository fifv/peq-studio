package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"
)

func defaultConfigDir() string {
	if dir := registryConfigDir(); dir != "" {
		return dir
	}
	base := os.Getenv("ProgramFiles")
	if base == "" {
		base = `C:\Program Files`
	}
	return filepath.Join(base, "EqualizerAPO", "config")
}

func run() error {
	configDir := flag.String("config-dir", "", "Equalizer APO config directory (default: registry or Program Files)")
	staticDir := flag.String("web-dir", "dist", "built frontend directory")
	var extraOrigins []string
	flag.Func("allow-origin", "additional trusted frontend origin, e.g. https://example.com (repeatable)", func(value string) error {
		if err := validateOrigin(value); err != nil {
			return err
		}
		extraOrigins = append(extraOrigins, value)
		return nil
	})
	flag.Parse()
	listener, err := net.Listen("tcp", "127.0.0.1:8765")
	if err != nil {
		return err
	}
	defer listener.Close()
	if *configDir == "" {
		*configDir = defaultConfigDir()
	}
	store, err := newConfigStore(*configDir)
	if err != nil {
		return err
	}
	server := &http.Server{
		Handler: newHandler(store, *staticDir, extraOrigins...), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second,
	}
	log.Printf("PEQ Studio console backend: http://%s", listener.Addr())
	log.Printf("Managed configuration: %s", store.path)
	log.Printf("Frontend access: local browser origins, %s, additional origins: %v", pagesOrigin, extraOrigins)
	log.Print("In Equalizer APO Configuration Editor, add Include: peqstudio.txt yourself. config.txt is never modified.")
	log.Print("Edits are written live while the browser is open. Ctrl+C stops the server; the last configuration remains in place.")
	if _, err := os.Stat(filepath.Join(*staticDir, "index.html")); err != nil {
		log.Print("Frontend build missing. Open https://fifv.github.io/peq-studio/ or run npm run dev in another console.")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	if err := server.Serve(listener); err != http.ErrServerClosed {
		return err
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
