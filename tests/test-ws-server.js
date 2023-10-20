// small demo websocket server to test forwarding client websocket connections via punchmole
import http from "node:http";
import {WebSocketServer} from "ws";

async function run(port) {
    const server = http.createServer()
    server.on('upgrade', (request, socket) => {
        // console.log('server upgrade', request.headers, socket, head);
        socket.headers = request.headers
        socket.origin_url = request.url
    })
    const wss = new WebSocketServer({
        server
    })

    wss.on('error', console.error)
    wss.on('connection', (socket) => {
        console.log(new Date(), 'client connection open')
        socket.on('close', () => {
            console.log(new Date(), 'connection closed')
        })
        socket.on('message', async (rawMessage) => {
            console.log('message', socket._socket.origin_url, socket._socket.headers, rawMessage.toString())
        })
        socket.send(JSON.stringify({type: 'hello', originUrl: socket._socket.origin_url, headers: socket._socket.headers}))
    })

    server.listen(port, () => {
        console.info(new Date(), `server is listening on port ${port}`)
    })

}

run(20000)
