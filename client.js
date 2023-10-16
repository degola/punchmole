import { PunchmoleClient } from "./app.js";

const API_KEY = process.env.API_KEY
const DOMAIN = process.env.DOMAIN
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000'
const PUNCHMOLE_ENDPOINT_URL = process.env.PUNCHMOLE_ENDPOINT_URL || 'ws://localhost:10000/client'

setTimeout(() => {
    PunchmoleClient(
        API_KEY,
        DOMAIN,
        TARGET_URL,
        PUNCHMOLE_ENDPOINT_URL
    )

}, 500)

