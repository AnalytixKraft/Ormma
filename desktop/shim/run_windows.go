//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

// createNoWindow runs a console program — Node is one — without the console
// window Windows would otherwise open for it. This program is built as a
// Windows (GUI) program, so it has none of its own either.
const createNoWindow = 0x08000000

// Runs Node and waits for it, then leaves with its exit code: the installer
// waits on `Ormma.exe stop` this way.
func run(node string, args, env []string) error {
	cmd := exec.Command(node, args...)
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	err := cmd.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		os.Exit(exit.ExitCode())
	}
	if err != nil {
		return err
	}
	os.Exit(0)
	return nil
}
