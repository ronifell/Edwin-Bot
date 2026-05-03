# Edwin WhatsApp Bot (Backend + Local Tester UI)

Proyecto con dos modos de operacion:

- `local`: prueba flujo conversacional desde un frontend estilo WhatsApp (Next.js + Tailwind).
- `whatsapp`: ejecucion real por Z-API sobre numero de WhatsApp.

## 1) Configurar backend

1. Copie `.env.example` a `.env`.
2. Defina modo con:
   - `BOT_CHANNEL_MODE=local` para pruebas en frontend.
   - `BOT_CHANNEL_MODE=whatsapp` para operacion real.
3. Complete `OPENAI_API_KEY` siempre.
4. Si usara `whatsapp`, complete:
   - `ZAPI_INSTANCE_ID`
   - `ZAPI_TOKEN`
   - `ZAPI_BASE_URL`
   - `CLIENT_TOKEN`
   - `ADMIN_REPORT_NUMBER`
   - `PRESERVE_UNREAD_ENABLED=true` para intentar mantener chats entrantes en no leido
5. Respuesta IA opcional:
   - `OPENAI_ENABLE_REPLY_GENERATION=false` (recomendado para flujo estable por reglas)
   - `true` si quiere que el mensaje verde se reescriba con OpenAI.

## 2) Configurar frontend de pruebas

1. En `frontend`, copie `.env.local.example` a `.env.local`.
2. Verifique:
   - `NEXT_PUBLIC_BACKEND_URL=http://localhost:3000`
   - Numero de prueba (`NEXT_PUBLIC_TEST_PHONE`) y nombre (`NEXT_PUBLIC_TEST_NAME`)

## 2.1) Configurar Admin web app (Next.js + Tailwind)

1. En `Admin`, copie `.env.local.example` a `.env.local`.
2. Defina:
   - `NEXT_PUBLIC_BACKEND_URL=http://localhost:3000`
   - `NEXT_PUBLIC_ADMIN_TOKEN` (opcional; debe coincidir con `ADMIN_API_TOKEN` del backend si usa token embebido)
3. En el backend (`.env` raiz), opcionalmente:
   - `ADMIN_PASSWORD`: si esta definido, el Admin puede iniciar sesion con contrasena; el endpoint `POST /api/admin/login` devuelve el bearer `ADMIN_API_TOKEN`.
4. Instale dependencias (si fallan scripts postinstall en Windows, use `npm install --ignore-scripts --prefix Admin`).

```bash
npm install --prefix Admin
```

**Funciones del panel:** lista de leads (PostgreSQL), papelera de reciclaje (borrado suave), restaurar / borrar definitivo, export CSV, detalle con linea de tiempo de conversacion (desde `data-store.json` del servidor cuando exista).

## 3) Instalar dependencias

Backend:

```bash
npm install
```

Frontend:

```bash
npm install --prefix frontend
```

## 4) Ejecutar en modo local (testing)

Use en `.env`: `BOT_CHANNEL_MODE=local`

Terminal 1 (backend):

```bash
npm run dev
```

Terminal 2 (frontend):

```bash
npm run dev:frontend
```

Terminal 3 (admin):

```bash
npm run dev:admin
```

Abra [http://localhost:3001](http://localhost:3001) y pruebe mensajes.
Admin: [http://localhost:3002](http://localhost:3002)

## 5) Ejecutar en modo WhatsApp real

Use en `.env`: `BOT_CHANNEL_MODE=whatsapp`

```bash
npm start
```

Configure Z-API para apuntar al webhook:

- `POST /webhook/zapi`

## Endpoints backend

- `GET /health`
- `POST /webhook/zapi` (solo habilitado en modo `whatsapp`)
- `POST /api/test/chat` (solo habilitado en modo `local`)
- `POST /jobs/daily-summary`
- `POST /api/admin/login` (opcional; requiere `ADMIN_PASSWORD` + `ADMIN_API_TOKEN`)
- `GET /api/admin/leads` (PostgreSQL; query `view=active|recycle`, `search`, `color`, paginacion)
- `GET /api/admin/leads/export` (CSV; mismos filtros que listado)
- `GET /api/admin/leads/:id` (detalle + conversacion desde almacen local del bot)
- `GET /api/admin/conversations/:phone`
- `GET /api/admin/stats` (PostgreSQL)
- `POST /api/admin/leads/:id/restore`
- `DELETE /api/admin/leads/:id` (borrado suave; `?permanent=true` solo en papelera)

## Simular escenarios de about.md

Para validar flujo y tono automaticamente:

```bash
npm run test:scenarios
```

Incluye pruebas para verde, amarillo, rojo, victima, preguntas informativas, saludo y control de repeticion despues de enviar datos.

## Generar blocklist de clientes antiguos

Para evitar responder clientes previos al go-live, puede generar un archivo de bloqueo desde export de contactos:

```bash
npm run build:blocklist -- --input "./contacts.vcf" --country 57
```

Tambien soporta CSV:

```bash
npm run build:blocklist -- --input "./contacts.csv" --output "./old_customers_blocklist.json" --country 57
```

Salida:

- Crea `old_customers_blocklist.json` con numeros normalizados (`+57...`), deduplicados y ordenados.
- Parametro `--country` define prefijo por defecto para numeros locales de 10 digitos.

## Incluye funcionalidad

- Clasificacion `green / yellow / red / purple`.
- Flujo empatico con variacion de respuestas.
- Soporte de notas de voz (transcripcion).
- Extraccion de cedula y fecha exacta de fallecimiento.
- Seguimiento automatico a conversaciones sin datos.
- Resumen diario de gestion.
- Guardado opcional en Google Sheets.
