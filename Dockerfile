FROM node:20-alpine as build
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk update && apk upgrade
#     apk add --no-cache bash git openssh
RUN npm install --omit dev
COPY . ./

FROM node:20-alpine as production
WORKDIR /app
RUN adduser -u 82 -D -S -G www-data www-data
COPY --from=build --chown=www-data:www-data /app ./
USER www-data
ENV NODE_ENV production
ENV PORT 10000

EXPOSE 10000

CMD ["npm", "run", "server"]
