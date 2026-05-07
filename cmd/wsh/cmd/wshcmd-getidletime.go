// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var getIdleTimeCmd = &cobra.Command{
	Use:                   "getidletime",
	Short:                 "print system idle time in seconds (no mouse/keyboard input)",
	RunE:                  getIdleTimeRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(getIdleTimeCmd)
}

func getIdleTimeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("getidletime", rtnErr == nil)
	}()
	seconds, err := wshclient.GetIdleTimeCommand(RpcClient, &wshrpc.RpcOpts{
		Timeout: 2000,
		Route:   wshutil.ElectronRoute,
	})
	if err != nil {
		return fmt.Errorf("getting idle time: %w", err)
	}
	fmt.Printf("%d\n", seconds)
	return nil
}
