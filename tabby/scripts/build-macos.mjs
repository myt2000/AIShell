#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { build as builder } from 'electron-builder'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vars from './vars.mjs'

const isTag = (process.env.GITHUB_REF || '').startsWith('refs/tags/')
const execFileAsync = promisify(execFile)
const hasSigningCertificate = !!process.env.CSC_LINK

async function adHocSign (configuration) {
    await execFileAsync('/usr/bin/codesign', [
        '--deep',
        '--force',
        '--sign', '-',
        '--timestamp=none',
        configuration.app,
    ])
}

process.env.ARCH = process.env.ARCH || process.arch

if (process.env.GITHUB_HEAD_REF) {
    delete process.env.CSC_LINK
    delete process.env.CSC_KEY_PASSWORD
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

process.env.APPLE_ID ??= process.env.APPSTORE_USERNAME
process.env.APPLE_APP_SPECIFIC_PASSWORD ??= process.env.APPSTORE_PASSWORD

builder({
    dir: true,
    mac: ['dmg', 'zip'],
    x64: process.env.ARCH === 'x86_64',
    arm64: process.env.ARCH === 'arm64',
    config: {
        extraMetadata: {
            version: vars.version,
            teamId: process.env.APPLE_TEAM_ID,
        },
        forceCodeSigning: !!process.env.CSC_LINK,
        mac: {
            notarize: !!process.env.APPLE_TEAM_ID,
            // A local Apple Silicon build still needs a complete signature after
            // Electron fuses are modified. Hardened runtime requires a real Team
            // ID, so use a full ad-hoc signature without it for unsigned builds.
            hardenedRuntime: hasSigningCertificate,
            sign: hasSigningCertificate ? undefined : adHocSign,
        },
        npmRebuild: process.env.ARCH !== 'arm64',
        publish: process.env.KEYGEN_TOKEN ? [
            vars.keygenConfig,
            {
                provider: 'github',
                channel: `latest-${process.env.ARCH}`,
            },
        ] : undefined,
    },
    publish: (process.env.KEYGEN_TOKEN && isTag) ? 'always' : 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
