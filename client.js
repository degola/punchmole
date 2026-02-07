#!/usr/bin/env node
import { PunchmoleClient } from "./app.js";

const PUNCHMOLE_ENDPOINT_URL = process.env.PUNCHMOLE_ENDPOINT_URL || 'ws://localhost:10000/_punchmole'
const PUNCHMOLE_API_KEY = process.env.PUNCHMOLE_API_KEY
const DEBUG = process.env.DEBUG === 'true'
const DOMAIN = process.env.DOMAIN
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000'

if(!DOMAIN) {
    console.error('please specify a domain by using environment variable DOMAIN')
    process.exit(1)
}

function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function startClient() {
    return new Promise((resolve) => {
        const events = PunchmoleClient(
            PUNCHMOLE_API_KEY,
            DOMAIN,
            TARGET_URL,
            PUNCHMOLE_ENDPOINT_URL, {
                error: console.error,
                warn: console.warn,
                info: console.info,
                debug: (...args) => DEBUG && console.debug(...args),
            }
        )
        events.on('close', () => {
            resolve()
        })
        events.on('error', () => {
            resolve()
        })
    })
}

setTimeout(async () => {
    while(true) {
        await startClient()
        console.log(new Date(), 'restarting client in 500ms')
        await wait(500)
    }


}, 500)

