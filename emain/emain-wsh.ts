// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WindowService } from "@/app/store/services";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { spawn } from "child_process";
import { Notification, net, powerMonitor, safeStorage, shell } from "electron";
import { getResolvedUpdateChannel } from "emain/updater";
import { existsSync } from "fs";
import { fireAndForget } from "../frontend/util/util";
import { unamePlatform } from "./emain-platform";
import { getWebContentsByBlockId, webGetSelector } from "./emain-web";
import {
    createBrowserWindow,
    getAllWaveWindows,
    getWaveWindowById,
    getWaveWindowByWorkspaceId,
} from "./emain-window";

export class ElectronWshClientType extends WshClient {
    constructor() {
        super("electron");
    }

    async handle_webselector(rh: RpcResponseHelper, data: CommandWebSelectorData): Promise<string[]> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("tabid and blockid are required");
        }
        const ww = getWaveWindowByWorkspaceId(data.workspaceid);
        if (ww == null) {
            throw new Error(`no window found with workspace ${data.workspaceid}`);
        }
        const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        const rtn = await webGetSelector(wc, data.selector, data.opts);
        return rtn;
    }

    async handle_notify(rh: RpcResponseHelper, notificationOptions: WaveNotificationOptions) {
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        const customSoundPath = fullConfig.settings["notification:soundfile"];
        const useCustomSound =
            process.platform === "win32" &&
            !notificationOptions.silent &&
            !!customSoundPath &&
            existsSync(customSoundPath);

        const n = new Notification({
            title: notificationOptions.title,
            body: notificationOptions.body,
            silent: useCustomSound ? true : notificationOptions.silent,
        });
        if (useCustomSound) {
            playWindowsCustomSound(customSoundPath);
        }
        const target = notificationOptions.target;
        if (!notificationOptions.nofocus && target?.blockid) {
            n.on("click", () => {
                fireAndForget(() => focusBlockFromNotification(target));
            });
        }
        n.show();
    }

    async handle_getupdatechannel(rh: RpcResponseHelper): Promise<string> {
        return getResolvedUpdateChannel();
    }

    async handle_focuswindow(rh: RpcResponseHelper, windowId: string) {
        console.log(`focuswindow ${windowId}`);
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        let ww = getWaveWindowById(windowId);
        if (ww == null) {
            const window = await WindowService.GetWindow(windowId);
            if (window == null) {
                throw new Error(`window ${windowId} not found`);
            }
            ww = await createBrowserWindow(window, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
        }
        ww.focus();
    }

    async handle_electronencrypt(
        rh: RpcResponseHelper,
        data: CommandElectronEncryptData
    ): Promise<CommandElectronEncryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = safeStorage.encryptString(data.plaintext);
        const ciphertext = encrypted.toString("base64");

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            ciphertext,
            storagebackend,
        };
    }

    async handle_electrondecrypt(
        rh: RpcResponseHelper,
        data: CommandElectronDecryptData
    ): Promise<CommandElectronDecryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = Buffer.from(data.ciphertext, "base64");
        const plaintext = safeStorage.decryptString(encrypted);

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            plaintext,
            storagebackend,
        };
    }

    async handle_networkonline(rh: RpcResponseHelper): Promise<boolean> {
        return net.isOnline();
    }

    async handle_electronsystembell(rh: RpcResponseHelper): Promise<void> {
        shell.beep();
    }

    async handle_getidletime(rh: RpcResponseHelper): Promise<number> {
        return powerMonitor.getSystemIdleTime();
    }

    // async handle_workspaceupdate(rh: RpcResponseHelper) {
    //     console.log("workspaceupdate");
    //     fireAndForget(async () => {
    //         console.log("workspace menu clicked");
    //         const updatedWorkspaceMenu = await getWorkspaceMenu();
    //         const workspaceMenu = Menu.getApplicationMenu().getMenuItemById("workspace-menu");
    //         workspaceMenu.submenu = Menu.buildFromTemplate(updatedWorkspaceMenu);
    //     });
    // }
}

export let ElectronWshClient: ElectronWshClientType;

export function initElectronWshClient() {
    ElectronWshClient = new ElectronWshClientType();
}

function playWindowsCustomSound(soundPath: string) {
    const winPath = soundPath.replace(/\//g, "\\");
    const escapedPath = winPath.replace(/'/g, "''");
    const psCommand = `(New-Object Media.SoundPlayer '${escapedPath}').PlaySync()`;
    try {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCommand],
            { windowsHide: true }
        );
        child.on("error", (err) => {
            console.log("playWindowsCustomSound spawn error:", err);
        });
        child.on("exit", (code) => {
            if (code !== 0) {
                console.log("playWindowsCustomSound exit code:", code);
            }
        });
    } catch (e) {
        console.log("playWindowsCustomSound failed:", e);
    }
}

async function focusBlockFromNotification(target: NotificationTarget) {
    let { blockid, tabid, workspaceid } = target;
    if (!tabid || !workspaceid) {
        try {
            const info = await RpcApi.BlockInfoCommand(ElectronWshClient, blockid);
            tabid = tabid || info.tabid;
            workspaceid = workspaceid || info.workspaceid;
        } catch (e) {
            console.log("notify click: block info failed", blockid, e);
            const fallback = getAllWaveWindows()[0];
            if (fallback == null) return;
            if (fallback.isMinimized()) fallback.restore();
            fallback.focus();
            return;
        }
    }
    let ww = getWaveWindowByWorkspaceId(workspaceid);
    if (ww == null) {
        ww = getAllWaveWindows()[0];
        if (ww == null) return;
        if (ww.isMinimized()) ww.restore();
        ww.focus();
        return;
    }
    if (ww.isMinimized()) ww.restore();
    ww.focus();
    try {
        await ww.setActiveTab(tabid, true);
    } catch (e) {
        console.log("notify click: setActiveTab failed", e);
        return;
    }
    try {
        await RpcApi.SetBlockFocusCommand(ElectronWshClient, blockid, {
            route: `tab:${tabid}`,
            timeout: 2000,
        });
    } catch (e) {
        console.log("notify click: SetBlockFocus failed", e);
    }
}
