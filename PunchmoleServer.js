import crypto from "node:crypto";
import http from "node:http";
import {WebSocketServer} from "ws";

function generateRandomId() {
    return crypto.randomBytes(16).toString("hex")
}

function getPathname(req) {
    try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
        return url.pathname
    } catch {
        return "/"
    }
}

export async function PunchmoleServer(
    port,
    apiKeys,
    endpointUrlPath = '/_punchmole',
    log = console
) {
    if(apiKeys.filter((v) => v !== "").length === 0) {
        throw new Error('invalid api keys, please check apiKeys argument')
    }
    const server = http.createServer((req, res) => {
        const requestedDomain = req.headers.host?.match(/^(.*?)(:[0-9]{1,}|)$/)?.[1]
        if (!requestedDomain) {
            res.writeHead(400, { "Content-Type": "text/plain" })
            res.end("missing Host header")
            return
        }

        const foreignHost = domainsToConnections[requestedDomain]
        log.debug(new Date(), 'request started for', requestedDomain, req.method, req.url)
        if(foreignHost && foreignHost.status === 'alive') {
            log.debug(new Date(), '-> found endpoint', req.url, req.headers)
            const requestForward = {
                type: "request-start",
                date: new Date(),
                domain: requestedDomain,
                id: generateRandomId(),
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: undefined,
            }
            log.debug(new Date(), '-> forward to remote client', JSON.stringify(requestForward))
            openRequests.push({...requestForward, requestObject: req, responseObject: res})
            foreignHost.socket.send(JSON.stringify(requestForward))
            req.on('data', (data) => {
                log.debug(new Date(), '--> request data received', requestForward.id, data.length)
                foreignHost.socket.send(JSON.stringify({
                    type: 'request-data',
                    date: new Date(),
                    id: requestForward.id,
                    data: data.toString('binary')
                }))
            })
            req.on('end', () => {
                log.debug(new Date(), '--> request data reception ended', requestForward.id)
                foreignHost.socket.send(JSON.stringify({
                    type: 'request-data-end',
                    date: new Date(),
                    id: requestForward.id
                }))
            })
        } else {
            const pathname = getPathname(req)
            if (pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/plain" })
                res.end("http server is running")
            } else {
                res.writeHead(503, { "Content-Type": "text/plain" })
                res.end("no registration for domain and/or remote service not available")
            }
        }
    })
    server.on('upgrade', (request, socket) => {
        socket.headers = request.headers
        socket.origin_url = request.url
    })

    const wss = new WebSocketServer({
        server
    })

    const domainsToConnections = {}
    let openRequests = []
    let openWebsocketConnections = []
    function getRequestObject(id) {
        return openRequests.find((v) => v.id === id)
    }

    wss.on('error', log.error)
    wss.on('connection', (socket) => {
        log.info(new Date(), 'client connection open', socket._socket.headers, socket._socket.origin_url)
        // if it's a punchmole client connection and not a foreign request connection
        if(socket._socket.origin_url === endpointUrlPath) {
            socket.on('close', () => {
                log.info(new Date(), 'connection closed', socket.domain)
                delete domainsToConnections[socket.domain]
            })
            socket.on('message', async (rawMessage) => {
                const message = JSON.parse(rawMessage)
                let request = null
                if (message.id) {
                    request = getRequestObject(message.id)
                }
                switch (message.type) {
                    case 'register':
                        if (apiKeys.includes(message.apiKey)) {
                            log.info(new Date(), 'registering socket for domain', message)
                            domainsToConnections[message.domain] = {
                                status: 'alive',
                                socket: socket
                            }
                            socket.domain = message.domain
                            socket.send(JSON.stringify({type: 'registered', domain: message.domain}))
                        } else {
                            log.error(new Date(), 'given api key is wrong/not recognised, stopping connection', message)
                            await socket.send(JSON.stringify({type: 'error', message: 'invalid api key'}))
                            socket.close()
                        }
                        break
                    case 'response-start':
                        log.info(new Date(), 'response start, request id', message.id, message.headers)
                        if (request) {
                            const res = request.responseObject
                            res.statusCode = message.statusCode
                            res.statusMessage = message.statusMessage || ''
                            for (const [key, value] of Object.entries(message.headers)) {
                                res.setHeader(key, value)
                            }
                            res.on('close', () => {
                                log.info(new Date(), 'connection closed, stop sending data', message.id)
                                openRequests = openRequests.filter((v) => v.id !== message.id)
                                socket.send(JSON.stringify({type: 'request-end', id: message.id}))
                            })
                        } else {
                            log.error(new Date(), 'didnt found response object, probably dead?')
                        }
                        break
                    case 'data':
                        if (request) {
                            const data = Buffer.from(message.data, 'binary')
                            // log.debug(new Date(), 'writing response data to request', message.id, data.length)
                            try {
                                request.responseObject.write(data)
                            } catch(e) {
                                log.info(new Date(), 'error writing data to response object, request was probably aborted', message.id, e)
                            }
                        } else {
                            log.error(new Date(), 'didnt found response object, unable to send data', message.id)
                        }
                        break
                    case 'data-end':
                        log.info(new Date(), 'finishing sending data for request', message.id)
                        if (request) {
                            request.responseObject.end()
                        } else {
                            log.error(new Date(), 'didnt found response object, unable to send data')
                        }
                        break
                    case 'websocket-connection-closed':
                        if(openWebsocketConnections[message.id]) {
                            try {
                                openWebsocketConnections[message.id].socket.close()
                            } catch(e) {
                                log.info(new Date(), 'error closing websocket connection, probably already closed', message.id, e)
                            }
                        }
                        break
                    case 'websocket-message':
                        const userSocket = openWebsocketConnections[message.id]
                        if(userSocket) {
                            log.debug(new Date(), 'sending websocket message received from proxied service to client', message.id)
                            userSocket.socket.send(message.rawData)
                        }
                        break
                }

            })
        } else {
            // this part handles incoming websocket connections from user requests and forwards them to the tunneled service
            const requestedDomain = socket._socket.headers.host.match(/^(.*?)(:[0-9]{1,}|)$/)[1]
            const foreignHost = domainsToConnections[requestedDomain]
            if(!foreignHost) {
                log.info(new Date(), 'received a websocket connection attempt for a domain not registered (yet), closing it', requestedDomain)
                socket.close()
            } else {
                socket.connectionId = generateRandomId()
                log.info(new Date(), 'received a websocket connection from a normal client and not a punchmole client, forwarding...', socket.connectionId, requestedDomain)
                openWebsocketConnections[socket.connectionId] = {
                    date: new Date(),
                    id: socket.connectionId,
                    socket: socket
                }
                foreignHost.socket.send(JSON.stringify({
                    type: 'websocket-connection',
                    id: socket.connectionId,
                    headers: socket._socket.headers,
                    domain: requestedDomain,
                    url: socket._socket.origin_url
                }))
                socket.on('error', (error) => {
                    log.info(new Date(), 'got error from client websocket connection', socket.connectionId, error)
                    foreignHost.socket.send(JSON.stringify({
                        type: 'websocket-error',
                        id: socket.connectionId,
                        error: error
                    }))
                })
                socket.on('close', () => {
                    log.info(new Date(), 'client websocket closed', socket.connectionId)
                    foreignHost.socket.send(JSON.stringify({
                        type: 'websocket-connection-closed',
                        id: socket.connectionId,
                    }))
                    openWebsocketConnections[socket.connectionId].socket.close()
                    delete openWebsocketConnections[socket.connectionId]
                })
                socket.on('message', (rawData) => {
                    log.info(new Date(), 'received data from client websocket connection, forwarding...', socket.connectionId)
                    foreignHost.socket.send(JSON.stringify({
                        type: 'websocket-message',
                        id: socket.connectionId,
                        rawData: rawData
                    }))
                })
            }
        }
    })

    server.listen(port, () => {
        log.info(new Date(), `server is listening on port ${port}`)
    })

    return {
        server,
        wss
    }
}
