import crypto from "node:crypto";
import express, {request} from "express";
import http from "node:http";
import {WebSocketServer} from "ws";

function generateRandomId() {
    return crypto.randomBytes(16).toString("hex")
}

export async function PunchmoleServer(port, apiKeys) {
    if(apiKeys.filter((v) => v !== "").length === 0) {
        throw new Error('invalid api keys, please check apiKeys argument')
    }
    const app = express()
    const server = http.createServer(app)
    const wss = new WebSocketServer({
        server
    })

    const domainsToConnections = {}
    let openRequests = []
    function getRequestObject(id) {
        return openRequests.find((v) => v.id === id)
    }

    wss.on('error', console.error)
    wss.on('connection', (socket) => {
        console.log(new Date(), 'client connection open')
        socket.on('close', () => {
            console.log(new Date(), 'connection closed', socket.domain)
            delete domainsToConnections[socket.domain]
        })
        socket.on('message', async (rawMessage) => {
            const message = JSON.parse(rawMessage)
            let request = null
            if(message.id) {
                request = getRequestObject(message.id)
            }
            switch(message.type) {
                case 'register':
                    if(apiKeys.includes(message.apiKey)) {
                        console.log(new Date(), 'registering socket for domain', message)
                        domainsToConnections[message.domain] = {
                            status: 'alive',
                            socket: socket
                        }
                        socket.domain = message.domain
                        socket.send(JSON.stringify({type: 'registered', domain: message.domain}))
                    } else {
                        console.error(new Date(), 'given api key is wrong/not recognised, stopping connection', message)
                        await socket.send(JSON.stringify({type: 'error', message: 'invalid api key'}))
                        socket.close()
                    }
                    break
                case 'response-start':
                    console.log(new Date(), 'response start, request id', message.id, message.headers)
                    if(request) {
                        request.responseObject.status(message.statusCode)
                        request.responseObject.statusMessage = message.statusMessage
                        request.responseObject.set(message.headers)
                        request.responseObject.on('close', () => {
                            console.log(new Date(), 'connection closed, stop sending data', message.id)
                            openRequests = openRequests.filter((v) => v.id !== message.id)
                            socket.send(JSON.stringify({type: 'request-end', id: message.id}))
                        })
                    } else {
                        console.error(new Date(), 'didnt found response object, probably dead?')
                    }
                    break
                case 'data':
                    if(request) {
                        const data = Buffer.from(message.data, 'binary')
                        // console.debug(new Date(), 'writing response data to request', message.id, data.length)
                        request.responseObject.write(data)
                    } else {
                        console.error(new Date(), 'didnt found response object, unable to send data', message.id)
                    }
                    break
                case 'data-end':
                    console.log(new Date(), 'finishing sending data for request', message.id)
                    if(request) {
                        request.responseObject.end()
                    } else {
                        console.error(new Date(), 'didnt found response object, unable to send data')
                    }
                    break
            }

        })
    })

    app.use((req, res, next) => {
        console.log('headers', req.headers)
        const requestedDomain = req.headers.host.match(/^(.*?):/)[1]
        const foreignHost = domainsToConnections[requestedDomain]
        console.debug(new Date(), 'request started for', requestedDomain, req.method, req.url)
        if(foreignHost && foreignHost.status === 'alive') {
            console.debug(new Date(), '-> found endpoint', req.url, req.headers, req.body)
            const requestForward = {
                type: "request-start",
                date: new Date(),
                domain: requestedDomain,
                id: generateRandomId(),
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: req.body,
            }
            console.debug(new Date(), '-> forward to remote client', JSON.stringify(requestForward))
            openRequests.push({...requestForward, requestObject: req, responseObject: res})
            foreignHost.socket.send(JSON.stringify(requestForward))
            req.on('data', (data) => {
                console.debug(new Date(), '--> request data received', requestForward.id, data.length)
                foreignHost.socket.send(JSON.stringify({
                    type: 'request-data',
                    date: new Date(),
                    id: requestForward.id,
                    data: data.toString('binary')
                }))
            })
            req.on('end', () => {
                console.debug(new Date(), '--> request data reception ended', requestForward.id)
                foreignHost.socket.send(JSON.stringify({
                    type: 'request-data-end',
                    date: new Date(),
                    id: requestForward.id
                }))
            })
        } else {
            res.status(503)
            res.send("no registration for domain and/or remote service not available")
        }
    })
    app.get('/', (req, res) => {
        res.send('http server is running')
    })


    server.listen(port, () => {
        console.info(new Date(), `server is listening on port ${port}`)
    })

    return {
        app,
        server,
        wss
    }
}
