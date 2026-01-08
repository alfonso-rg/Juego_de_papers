# 🎮 Quiz Papers

Juego multijugador de quiz sobre papers académicos para Berti, Ismael y Alfonso.

## 🚀 Setup Rápido

### 1. Configurar Variables de Entorno

Crea un archivo `.env` basándote en `.env.example`:

```bash
cp .env.example .env
```

Edita `.env` y configura:

```env
# MongoDB Connection
MONGO_URI=tu-connection-string-de-mongodb

# JWT Secret (generar uno nuevo con el comando de abajo)
JWT_SECRET=tu-secret-super-seguro

# Contraseña por defecto (solo para inicializar)
DEFAULT_PASSWORD=cambiar123

# Orígenes permitidos (tu dominio de Render)
ALLOWED_ORIGINS=https://tu-app.onrender.com

# Puerto
PORT=3001
```

### 2. Generar JWT Secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copia el resultado y pégalo en `JWT_SECRET` en tu `.env`.

### 3. Instalar Dependencias

```bash
npm install
```

### 4. Inicializar Usuarios (SOLO UNA VEZ)

Después de configurar MongoDB, visita:

```
http://localhost:3001/init-players
```

Esto creará tres usuarios:
- **Berti**
- **Ismael**
- **Alfonso**

Todos con la contraseña por defecto: **`cambiar123`**

### 5. Iniciar el Servidor

```bash
npm start
```

## 🔐 Primer Login

### Para cada usuario:

1. **Abrir** http://localhost:3001
2. **Seleccionar** tu nombre del dropdown
3. **Introducir** la contraseña por defecto: `cambiar123`
4. **Click en "Entrar"**
5. **IMPORTANTE**: Serás redirigido automáticamente a la pantalla de cambio de contraseña
6. **Cambiar** tu contraseña a una personal (mínimo 6 caracteres)

⚠️ **IMPORTANTE**: Cada usuario DEBE cambiar su contraseña en el primer login por seguridad.

## 📱 Uso Diario

### Login Normal

1. Selecciona tu nombre
2. Introduce tu contraseña personal
3. ¡A jugar!

### Persistencia de Sesión

- Tu sesión se guarda automáticamente
- Si refrescas la página, seguirás conectado
- El token expira después de 24 horas

### Cambiar Contraseña (después del primer login)

Si quieres cambiar tu contraseña en cualquier momento:

1. Desde el **Menú Principal**
2. Click en **"Cambiar Contraseña"**
3. Introduce tu contraseña actual
4. Introduce tu nueva contraseña (mín. 6 caracteres)
5. Confirma la nueva contraseña

## 🎯 Modos de Juego

### Timeline Solo
Ordena papers cronológicamente del más antiguo al más reciente.

### Matching Solo
Empareja cada paper con su año, autores y journal.

### Duelos Multijugador
Compite contra otros jugadores en tiempo real:
- 2-3 jugadores
- 3-5 papers por partida
- Puntos según posición (1º: 3pts, 2º: 2pts, 3º: 1pt)

## 📊 Sistema de Puntos

### Modo Solo
- **Primer intento correcto**: +N puntos (N = número de papers)
- **Primer intento incorrecto**: -(N-1) puntos
- Intentos posteriores: sin puntos

### Modo Duelo
- 1º lugar: +3 puntos
- 2º lugar: +2 puntos
- 3º lugar: +1 punto

## 🛠️ Deployment en Render

### 1. Conectar Repositorio

En Render, crea un nuevo Web Service y conecta tu repositorio de GitHub.

### 2. Configurar Variables de Entorno

En el dashboard de Render, añade:

```
JWT_SECRET=<tu-secret-generado>
MONGO_URI=<tu-mongodb-connection-string>
ALLOWED_ORIGINS=https://tu-app.onrender.com
DEFAULT_PASSWORD=cambiar123
```

⚠️ **Reemplaza** `https://tu-app.onrender.com` con tu URL real de Render.

### 3. Deploy

Render automáticamente instalará dependencias y ejecutará:

```bash
npm start
```

### 4. Inicializar Usuarios en Producción

Visita **UNA SOLA VEZ**:

```
https://tu-app.onrender.com/init-players
```

### 5. Compartir con los Jugadores

Envía a Berti, Ismael y Alfonso:

```
🎮 Quiz Papers está listo!

URL: https://tu-app.onrender.com
Contraseña inicial: cambiar123

⚠️ IMPORTANTE: Cambia tu contraseña en el primer login
```

## 🔧 Administración

### Gestionar Papers
- Añadir nuevos papers
- Editar papers existentes
- Eliminar papers

### Gestionar Puntos
- Reiniciar puntos semanales
- Reiniciar puntos históricos (¡cuidado!)

### Ver Rankings
- Clasificación semanal
- Clasificación histórica total

## 🔒 Seguridad

✅ Autenticación JWT con tokens de 24h
✅ Contraseñas hasheadas con bcrypt
✅ Validación de todos los inputs
✅ Protección contra NoSQL injection
✅ Rate limiting (100 req/15min)
✅ CORS restringido a dominios permitidos
✅ Socket.io autenticado
✅ Headers de seguridad con Helmet.js

## 📝 Notas Técnicas

### Stack
- **Backend**: Node.js + Express
- **Database**: MongoDB Atlas
- **Real-time**: Socket.io
- **Auth**: JWT + bcryptjs
- **Frontend**: Vanilla JS + SweetAlert2

### Arquitectura de Seguridad
- Todos los endpoints API requieren JWT válido
- Contraseñas NUNCA se almacenan en texto plano
- Tokens se guardan en localStorage para persistencia
- Rate limiting para prevenir ataques de fuerza bruta

### Troubleshooting

**"Authentication error" al conectar:**
- Tu token expiró (24h). Vuelve a hacer login.

**"No se pudieron cargar los jugadores":**
- Verifica que MongoDB esté conectado.

**"Contraseña actual incorrecta":**
- Verifica que estás usando tu contraseña personal, no la por defecto.

## 📄 Licencia

Proyecto personal para uso interno.

---

Desarrollado con ❤️ por Alfonso con la ayuda de Claude Code
