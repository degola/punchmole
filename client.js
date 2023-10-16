#!/usr/bin/env node

import { PunchmoleClient } from "./app.js";

const PUNCHMOLE_ENDPOINT_URL = process.env.PUNCHMOLE_ENDPOINT_URL || 'ws://localhost:10000/client'
const PUNCHMOLE_API_KEY = process.env.PUNCHMOLE_API_KEY
const DOMAIN = process.env.DOMAIN
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000'

function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function startClient() {
    return new Promise((resolve) => {
        const events = PunchmoleClient(
            PUNCHMOLE_API_KEY,
            DOMAIN,
            TARGET_URL,
            PUNCHMOLE_ENDPOINT_URL
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

