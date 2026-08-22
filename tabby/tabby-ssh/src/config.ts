import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class SSHConfigProvider extends ConfigProvider {
    defaults = {
        ssh: {
            warnOnClose: false,
            winSCPPath: null,
            agentType: 'auto',
            agentPath: null,
            x11Display: null,
            knownHosts: [],
            verifyHostKeys: true,
            // AISHELL: 智能 Keepalive —— 全局默认值（profile 未设置时生效）
            keepaliveInterval: 15000,
            keepaliveCountMax: 6,
            // AISHELL: 跳板链自动收紧心跳间隔
            adaptiveKeepalive: true,
        },
        hotkeys: {
            'restart-ssh-session': [],
            'launch-winscp': [],
            'open-sftp': [],
        },
    }

    platformDefaults = { }
}
