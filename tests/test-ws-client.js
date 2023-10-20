// small demo websocket client to test forwarding client websocket connections via punchmole
import {WebSocket} from "ws";

async function run(endpointUrl) {
    const ws = new WebSocket(endpointUrl)

    ws.on('open', () => {
        ws.send(JSON.stringify({'type': 'hello'}))
        ws.isAlive = true
    })
    const interval = setInterval(() => {
        ws.ping()
    }, 10000)
    ws.on('ping', () => {
        ws.pong()
    })
    ws.on('pong', () => {
    })
    ws.on('close', () => {
        console.log(new Date(), 'connection with upstream server closed')
        clearInterval(interval)
    })
    ws.on('error', (err) => {
        console.error(new Date(), 'websocket error', err)
    })
    ws.on('message', async (rawMessage) => {
        console.log('message received from server', rawMessage.toString())
    })
}

// nodemon delay when running test-ws-server and test-ws-client in parallel
setTimeout(() => {
    run('ws://testdomain.com:10000/this-is-a-test-endpoint')

}, 500)
