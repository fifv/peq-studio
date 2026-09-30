package main

import "time"

// APO, its editor and scanners can briefly open the config without delete sharing.
// Replacing it must wait for those handles, but a short lock is not a lost connection.
type configBusyError struct{ err error }

func (e *configBusyError) Error() string { return e.err.Error() }
func (e *configBusyError) Unwrap() error { return e.err }

const fileRetryBudget = 250 * time.Millisecond

func retryFileAccess(operation func() error) error {
	deadline := time.Now().Add(fileRetryBudget)
	delay := 5 * time.Millisecond
	for {
		err := operation()
		if err == nil || !transientFileError(err) {
			return err
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return &configBusyError{err: err}
		}
		time.Sleep(min(delay, remaining))
		delay = min(delay*2, 40*time.Millisecond)
	}
}
