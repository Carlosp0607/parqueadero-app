# Imagen base ligera. El proyecto declara Node >= 18 en package.json.
FROM node:20-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Se copian primero los manifiestos para aprovechar la cache de capas:
# mientras package.json no cambie, Docker reutiliza el npm ci de la capa anterior.
COPY package*.json ./

# npm ci instala exactamente las versiones del lock. --omit=dev deja fuera
# nodemon, pkg y demas herramientas de desarrollo.
RUN npm ci --omit=dev

# Resto del codigo
COPY . .

# El contenedor no corre como root
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]