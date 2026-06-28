FROM nginx:alpine
RUN apk add --no-cache python3 \
    && mkdir -p /var/cache/nginx/ghfb \
    && chown -R nginx:nginx /var/cache/nginx/ghfb
COPY deploy/cache.conf /etc/nginx/conf.d/00-cache.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/checkin_proxy.py /opt/checkin_proxy.py
COPY server /opt/server
COPY deploy/start-ghfb.sh /opt/start-ghfb.sh
RUN chmod +x /opt/start-ghfb.sh /opt/checkin_proxy.py
COPY *.html /usr/share/nginx/html/
COPY shared /usr/share/nginx/html/shared/
COPY js /usr/share/nginx/html/js/
COPY check-in-config.js /usr/share/nginx/html/
COPY manifest.webmanifest sw.js /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons/
COPY images /usr/share/nginx/html/images/
COPY files /usr/share/nginx/html/files/
COPY data /usr/share/nginx/html/data/
EXPOSE 80
CMD ["/opt/start-ghfb.sh"]
