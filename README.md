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
5. Respuesta IA opcional:
   - `OPENAI_ENABLE_REPLY_GENERATION=false` (recomendado para flujo estable por reglas)
   - `true` si quiere que el mensaje verde se reescriba con OpenAI.

## 2) Configurar frontend de pruebas

1. En `frontend`, copie `.env.local.example` a `.env.local`.
2. Verifique:
   - `NEXT_PUBLIC_BACKEND_URL=http://localhost:3000`
   - Numero de prueba (`NEXT_PUBLIC_TEST_PHONE`) y nombre (`NEXT_PUBLIC_TEST_NAME`)

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

Abra [http://localhost:3001](http://localhost:3001) y pruebe mensajes.

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

## Simular escenarios de about.md

Para validar flujo y tono automaticamente:

```bash
npm run test:scenarios
```

Incluye pruebas para verde, amarillo, rojo, victima, preguntas informativas, saludo y control de repeticion despues de enviar datos.

## Incluye funcionalidad

- Clasificacion `green / yellow / red / purple`.
- Flujo empatico con variacion de respuestas.
- Soporte de notas de voz (transcripcion).
- Extraccion de cedula y fecha exacta de fallecimiento.
- Seguimiento automatico a conversaciones sin datos.
- Resumen diario de gestion.
- Guardado opcional en Google Sheets.
