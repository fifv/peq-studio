package main

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
)

const pagesOrigin = "https://fifv.github.io"

func validateOrigin(origin string) error {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return fmt.Errorf("expected a full http(s) origin without a path, for example https://example.com")
	}
	return nil
}

func trustedOrigin(origin string, extraOrigins []string) bool {
	if validateOrigin(origin) != nil {
		return false
	}
	if origin == pagesOrigin {
		return true
	}
	for _, allowed := range extraOrigins {
		if origin == allowed {
			return true
		}
	}
	u, _ := url.Parse(origin)
	ip := net.ParseIP(u.Hostname())
	return u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
}

func allowAPIRequest(w http.ResponseWriter, r *http.Request, extraOrigins []string) bool {
	w.Header().Add("Vary", "Origin")
	w.Header().Add("Vary", "Access-Control-Request-Private-Network")
	origin := r.Header.Get("Origin")
	if origin != "" {
		if !trustedOrigin(origin, extraOrigins) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "This frontend origin is not allowed. Start the backend with -allow-origin for your trusted site."})
			return false
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if r.Method == http.MethodOptions {
		method := r.Header.Get("Access-Control-Request-Method")
		if origin == "" || (method != "GET" && method != "PUT") {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Unsupported preflight request."})
			return false
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-PEQ-Token")
		w.Header().Set("Access-Control-Max-Age", "600")
		// Compatibility with browsers using Private Network Access preflights.
		if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	return true
}
