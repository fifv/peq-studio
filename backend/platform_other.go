//go:build !windows

package main

import "os"

func registryConfigDir() string { return "" }

func transientFileError(err error) bool { return false }

func replaceFile(source, destination string) error { return os.Rename(source, destination) }
