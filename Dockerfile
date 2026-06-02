FROM nginx:alpine
RUN mkdir -p /var/cache/nginx/ghfb && chown -R nginx:nginx /var/cache/nginx/ghfb
COPY deploy/cache.conf /etc/nginx/conf.d/00-cache.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY *.html /usr/share/nginx/html/
COPY manifest.webmanifest sw.js /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons/
COPY images /usr/share/nginx/html/images/
EXPOSE 80
