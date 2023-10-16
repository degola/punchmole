import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import http from 'node:http'

export function PunchmoleClient(apiKey, domain, targetUrl, endpointUrl) {
    const eventEmitter = new EventEmitter()
    const ws = new WebSocket(endpointUrl)

    ws.on('open', () => {
        console.log(new Date(), 'connection with upstream server opened to forward url', targetUrl)
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
        console.log(new Date(), 'connection with upstream server closed')
        clearInterval(interval)
        eventEmitter.emit('close')
    })
    ws.on('error', (err) => {
        console.error(new Date(), 'websocket error', err)
        eventEmitter.emit('error', err)
    })
    const controllers = {}
    const requests = {}
    ws.on('message', async (rawMessage) => {
        const request = JSON.parse(rawMessage)
        let targetRequest = requests[request.id]
        switch(request.type) {
            case 'error':
                console.error(new Date(), 'error received from upstream server', request)
                eventEmitter.emit('error', request)
                break
            case 'registered':
                console.log(new Date(), 'registration successful', request)
                eventEmitter.emit('registered', request)
                break
            case 'request-end':
                // if the foreign host stops the connection we need to stop streaming data (if we're streaming...)
                console.log(new Date(), 'request end received, stopping data if there is any', request.id)
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
                console.log(new Date(), 'received request', JSON.stringify(request))
                console.log(new Date(), 'forwarding url', JSON.stringify(url))

                requests[request.id] = {
                    request: http.request(url, {
                        method: request.method,
                        headers: request.headers,
                        signal: controllers[request.id].controller.signal
                    }, (response) => {
                        ws.send(JSON.stringify({
                            type: 'response-start',
                            id: request.id,
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            headers: response.headers
                        }))

                        response.on('data', data => {
                            // console.log('receiving data from endpoint', data.toString('binary').length)
                            ws.send(JSON.stringify({
                                type: 'data',
                                id: request.id,
                                data: data.toString('binary')
                            }))
                        })
                        response.on('end', async () => {
                            // console.log('stream end')
                            await ws.send(JSON.stringify({
                                type: 'data-end',
                                id: request.id
                            }))
                        })
                        controllers[request.id].controller.signal.addEventListener('abort', () => {
                            console.log(new Date(), 'ending stream, remote client closed connection', request.id)
                            response.destroy()
                        }, { once: true })
                    })
                }
                eventEmitter.emit('request', request)
                break
            case 'request-data':
                if(targetRequest && targetRequest.request) {
                    console.log(new Date(), 'request data has been received forwarding to remote service', request.id, Buffer.from(request.data, 'binary').length)
                    targetRequest.request.write(Buffer.from(request.data, 'binary'))
                }
                break
            case 'request-data-end':
                if(targetRequest && targetRequest.request) {
                    console.log(new Date(), 'request has been finished, ending request to remote service', request.id)
                    targetRequest.request.end()
                }
                break

        }
    })
    return eventEmitter
}
