//go:build !windows

package main

import "syscall"

// Becomes Node, keeping this process: launchd keeps an eye on the process
// it started, so that must be the one that runs Ormma.
func run(node string, args, env []string) error {
	return syscall.Exec(node, append([]string{node}, args...), env)
}
