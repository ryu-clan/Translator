FROM quay.io/vorterx/xastral:latest
RUN git clone https://github.com/PhoenixFury0000/Translator /root/xastral/
WORKDIR /root/xastral/
RUN rm -rf node_modules yarn.lock
RUN yarn install --network-concurrency 1
CMD ["npm", "start"]
