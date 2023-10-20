# Punchmole

Punchmole is a simple tool to give your locally running HTTP(s) servers a public URL 
and is an easy to self-host alternative to `ngrok` and/or `tunnelmole`.

Implemented in Node with the goal to have as much flexibility and as little dependencies and code as possible.

The project has 2 components:
- **Client:** runs locally to connect a given HTTP endpoint running locally (or in a non-public network).
- **Server:** deployable on a server, behind a reverse proxy connects to the outside world and any domain it is accessible from

This service allows streaming of origin request (e.g. file-uploads, other than Tunnelmole which buffers request data completely in memory).
The service also supports Websocket proxying depending on websocket endpoint url path

Client & Server are both solely configurable via ENV-variables.

## Status

This project is experimental and currently used for some pet-projects, quickly hacked together in a few hours.

Well-known issues:
- almost no error handling
- no tests

## Server

The server opens a single HTTP port to which the Punchmole client connects and upgrades to a websocket connection.

Each request to this HTTP port is forwarded (based on clients HOST header) to a corresponding connected Punchmole
client connection which can ultimately serve the request.

### Environment variables

| Variable | Default Value | Description                                                                                                                                                                          |
|----------|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| PORT     | 10000         | HTTP port on which the server listens                                                                                                                                                |
| API_KEYS | n/a           | A comma-separated list of API keys the server accepts connections for                                                                                                                |
| PUNCHMOLE_ENDPOINT_URL_PATH | /_punchmole   | A WebSocket URL path which is used to determine if the incoming connection is for punchmole to register and connect a punchmole client or a user request which needs to be forwarded |


### Installation
```bash
npm install -g punchmole
```

### Run
```bash
PORT=10000 \
API_KEYS=api-key1,api-key2,random-string-nobody-can-guess \
PUNCHMOLE_ENDPOINT_URL_PATH=/_punchmole \
punchmole-server 
```

### Run on docker
```bash
docker build -t punchmole .
docker run -e API_KEYS=api-key1,api-key2,random-string-nobody-can-guess punchmole
```

### Usage in own Node code

The server can also easily get used in your own project:
```javascript
import { PunchmoleServer } from "punchmole";

PunchmoleServer(
    PORT, // port number to listen on
    API_KEYS, // array of api keys (random strings)
    PUNCHMOLE_ENDPOINT_URL_PATH, // /_punchmole is the default path
    console // console, {info: {}, debug: {}, error: {}} for no logs or e.g. an instance of log4js
)
```

## Client

The client connects to the Punchmole server, with first connection the client shares the given API key and a domain it wants
to receive requests for.


### Environment variables

| Variable               | Default Value                   | Description                                                                                                                                  |
|------------------------|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| PUNCHMOLE_API_KEY      | n/a                             | An API-key the server accepts                                                                                                                |
| DOMAIN                 | n/a                             | The domain the client wants to receive requests for                                                                                          |
| TARGET_URL             | http://localhost:3000           | URL to which the incoming requests are forwarded to, either local or within the private network                                              |
| PUNCHMOLE_ENDPOINT_URL | ws://localhost:10000/_punchmole | Websocket URL of the Punchmole server, make sure if you want to change /_punchmole to adjust `PUNCHMOLE_ENDPOINT_URL_PATH` in punchmole server |

### Installation
```bash
npm install -g punchmole
```

### Run
```bash
PUNCHMOLE_ENDPOINT_URL=ws://localhost:10000/_punchmole \
TARGET_URL=http://localhost:3000 \
API_KEY=api-key1 \
DOMAIN=testdomain.com \
punchmole
```

### Usage in own Node code

The client can also easily get used in your own project:
```javascript
import { PunchmoleClient } from "punchmole";

const punchmoleEvents = PunchmoleClient(
    "API KEY",
    "DOMAIN",
    "TARGET URL",
    "PUNCHMOLE ENDPOINT URL"
)
punchmoleEvents.addListener("registered", (result) => console.log(result))
punchmoleEvents.addListener("request", (result) => console.log(result))
punchmoleEvents.addListener("request-end", (result) => console.log(result))
```
