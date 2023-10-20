import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import http from 'node:http'

export function PunchmoleClient(apiKey, domain, targetUrl, endpointUrl, log = console) {
    const eventEmitter = new EventEmitter()
    const ws = new WebSocket(endpointUrl)

    ws.on('open', () => {
        log.info(new Date(), 'connection with upstream server opened to forward url', targetUrl)
        ws.send(JSON.stringify({'type': 'register', 'domain': domain, 'apiKey': apiKey}))
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
        log.info(new Date(), 'connection with upstream server closed')
        clearInterval(interval)
        eventEmitter.emit('close')
    })
    ws.on('error', (err) => {
        log.error(new Date(), 'websocket error', err)
        eventEmitter.emit('error', err)
    })
    const controllers = {}
    const requests = {}
    const websocketConnections = {}
    // opening a new websocket may take some time and the remote server has already sent the first message
    // for that purpose we push messages to a buffer (in order until the buffer is empty) which is sent then
    // automatically once the websocket connection for one connection id (request id) is open,
    let websocketMessageBuffer = []
    // run through all buffered websocket messages in 30ms intervals and check if they're sendable
    setInterval(() => {
        for(let message of websocketMessageBuffer) {
            if(
                websocketConnections[message.request.id] &&
                websocketConnections[message.request.id].readyState === WebSocket.OPEN
            ) {
                log.info('sending buffered message to finally opened websocket connection', message)
                websocketConnections[message.request.id].send(message.request.rawData)
                websocketMessageBuffer = websocketMessageBuffer.filter((v) => v.request.id !== message.request.id)
            }
        }
    }, 30)
    ws.on('message', async (rawMessage) => {
        const request = JSON.parse(rawMessage)
        let targetRequest = requests[request.id]
        switch(request.type) {
            case 'error':
                log.error(new Date(), 'error received from upstream server', request)
                eventEmitter.emit('error', request)
                break
            case 'registered':
                log.info(new Date(), 'registration successful', request)
                eventEmitter.emit('registered', request)
                break
            case 'request-end':
                // if the foreign host stops the connection we need to stop streaming data (if we're streaming...)
                log.debug(new Date(), 'request end received, stopping data if there is any', request.id)
                // cleaning up status controllers
                if(controllers[request.id]) {
                    controllers[request.id].controller.abort()
                    delete controllers[request.id].controller
                    delete controllers[request.id]
                }
                // cleaning up requests
                if(requests[request.id]) {
                    requests[request.id].request.destroy()
                    delete requests[request.id]
                }
                eventEmitter.emit('request-end', request)
                break
            case 'request-start':
                controllers[request.id] = {date: new Date(), controller: new AbortController()}
                const url = targetUrl + request.url
                log.info(new Date(), 'received request', JSON.stringify(request))
                log.debug(new Date(), 'forwarding url', JSON.stringify(url))

                requests[request.id] = {
                    responseStarted: false,
                    request: http.request(url, {
                        method: request.method,
                        headers: request.headers,
                        signal: controllers[request.id].controller.signal
                    }, (response) => {
                        requests[request.id].responseStarted = true
                        ws.send(JSON.stringify({
                            type: 'response-start',
                            id: request.id,
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            headers: response.headers
                        }))

                        response.on('data', data => {
                            ws.send(JSON.stringify({
                                type: 'data',
                                id: request.id,
                                data: data.toString('binary')
                            }))
                        })
                        response.on('end', async () => {
                            await ws.send(JSON.stringify({
                                type: 'data-end',
                                id: request.id
                            }))
                        })
                        controllers[request.id].controller.signal.addEventListener('abort', () => {
                            log.info(new Date(), 'ending stream, remote client closed connection', request.id)
                            response.destroy()
                        }, { once: true })
                    })
                }
                requests[request.id].request.on('error', (err) => {
                    log.error(new Date(), 'request error', request.id, err);
                    if(!requests[request.id] || requests[request.id].responseStarted === false) {
                        ws.send(JSON.stringify({
                            type: 'response-start',
                            id: request.id,
                            statusCode: 503,
                            statusMessage: 'Service Unavailable',
                            headers: {}
                        }))
                        ws.send(JSON.stringify({
                            type: 'data',
                            id: request.id,
                            data: err.toString('binary')
                        }))
                    }
                    ws.send(JSON.stringify({
                        type: 'data-end',
                        id: request.id
                    }))

                    if(requests[request.id]) {
                        requests[request.id].request.destroy()
                        delete requests[request.id]
                    }
                })
                eventEmitter.emit('request', request)
                break
            case 'request-data':
                if(targetRequest && targetRequest.request) {
                    log.debug(new Date(), 'request data has been received forwarding to remote service', request.id, Buffer.from(request.data, 'binary').length)
                    targetRequest.request.write(Buffer.from(request.data, 'binary'))
                }
                break
            case 'request-data-end':
                if(targetRequest && targetRequest.request) {
                    log.debug(new Date(), 'request has been finished, ending request to remote service', request.id)
                    targetRequest.request.end()
                }
                break
            case 'websocket-connection':
                log.info(new Date(), 'new websocket connection requested', request, targetUrl)
                const websocketConnectionUrl = targetUrl.replace(/^http/, 'ws') + request.url
                log.debug(new Date(), '-> opening websocket connection...', websocketConnectionUrl)
                websocketConnections[request.id] = new WebSocket(websocketConnectionUrl)
                websocketConnections[request.id].on('message', (rawData) => {
                    ws.send(JSON.stringify({
                        type: 'websocket-message',
                        id: request.id,
                        rawData: rawData
                    }))
                })
                websocketConnections[request.id].on('close', () => {
                    log.info(new Date(), 'service side closed websocket connection, sending forward and cleaning up...', request.id)
                    ws.send(JSON.stringify({
                        type: 'websocket-connection-closed',
                        id: request.id
                    }))
                    delete websocketConnections[request.id]
                })
                websocketConnections[request.id].on('error', (error) => {
                    log.warn(new Date(), 'websocket connected to service got an error', error)
                })
                break
            case 'websocket-connection-closed':
                if(websocketConnections[request.id]) {
                    log.debug(new Date(), 'remote client closed connection to websocket, closing websocket connection', request.id)
                    websocketConnections[request.id].close()
                }
                break
            case 'websocket-message':
                if(
                    websocketConnections[request.id] &&
                    websocketConnections[request.id].readyState === WebSocket.OPEN &&
                    // check if the websocket message buffer has messages for the given connection (request id) and if it
                    // has enqueue new messages rather then sending it directly to ensure the order is given
                    // (some protocols require separate authentication and/or handshake procedures which keep account for here)
                    !websocketMessageBuffer.find((v) => v.request.id === request.id)
                ) {
                    log.debug(new Date(), 'websocket message received and ready to send forward', request.id)
                    websocketConnections[request.id].send(request.rawData)
                } else {
                    log.debug(new Date(), 'websocket message received but not ready to send forward yet, buffering...', request.id)
                    websocketMessageBuffer.push({
                        date: new Date(),
                        request: request,
                    })
                }
        }
    })
    return eventEmitter
}
