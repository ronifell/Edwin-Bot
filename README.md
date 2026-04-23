# Edwin WhatsApp Bot Backend (Node.js)

Backend para automatizar la atencion de casos de pension de sobrevivientes por WhatsApp usando Z-API + OpenAI.

## Incluye

- Webhook `POST /webhook/zapi` para recibir mensajes.
- Clasificacion de casos: `green`, `yellow`, `red`, `purple`.
- Flujo humano/empatico con respuestas variables.
- Soporte de audio: transcribe notas de voz a texto.
- Extraccion de datos clave: cedula, fecha de fallecimiento, reclamante.
- Seguimiento automatico si no envian datos.
- Resumen diario de negocio enviado por WhatsApp al numero administrador.
- Guardado opcional en Google Sheets.

## Configuracion

1. Copie `.env.example` a `.env`.
2. Complete credenciales:
   - `ZAPI_INSTANCE_ID`
   - `ZAPI_TOKEN`
   - `ZAPI_BASE_URL`
   - `CLIENT_TOKEN`
   - `OPENAI_API_KEY`
3. Configure `ADMIN_REPORT_NUMBER` para recibir el resumen diario.
4. (Opcional) Active Google Sheets:
   - `GOOGLE_SHEETS_ENABLED=true`
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`

## Instalar y ejecutar

```bash
npm install
npm run dev
```

Produccion:

```bash
npm start
```

## Endpoints

- `GET /health`
- `POST /webhook/zapi`
- `POST /jobs/daily-summary` (disparo manual)

## Notas de almacenamiento

Se usa archivo local `data-store.json` para conversaciones y estadisticas diarias.

Si luego quiere persistencia robusta (PostgreSQL/MongoDB), se puede migrar sin tocar la logica principal del bot.
