package main

import (
	"errors"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

func registryConfigDir() string {
	for _, view := range []string{"/reg:64", "/reg:32"} {
		out, err := exec.Command("reg.exe", "query", `HKLM\SOFTWARE\EqualizerAPO`, "/v", "ConfigPath", view).Output()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(out), "\n") {
			if _, value, ok := strings.Cut(line, "REG_SZ"); ok {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

var moveFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")

func transientFileError(err error) bool {
	return errors.Is(err, syscall.ERROR_ACCESS_DENIED) ||
		errors.Is(err, syscall.Errno(32)) || // ERROR_SHARING_VIOLATION
		errors.Is(err, syscall.Errno(33)) // ERROR_LOCK_VIOLATION
}

func replaceFile(source, destination string) error {
	from, err := syscall.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	to, err := syscall.UTF16PtrFromString(destination)
	if err != nil {
		return err
	}
	// Same-directory replacement: readers see the entire old or new config.
	// Closed buffered writes are visible to APO; forcing physical disk flushes on
	// every wheel tick is unnecessary for live audio and can stall rapid changes.
	ok, _, err := moveFileEx.Call(uintptr(unsafe.Pointer(from)), uintptr(unsafe.Pointer(to)), 0x1)
	if ok == 0 {
		return err
	}
	return nil
}
