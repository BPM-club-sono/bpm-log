# Étape 1 : build du frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# Les variables VITE_* sont inlinées dans le bundle au moment du build :
# elles doivent exister ici, pas au runtime du conteneur nginx.
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID

RUN npm run build

# Étape 2 : servir avec nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
