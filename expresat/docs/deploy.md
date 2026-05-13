# Guía de Despliegue - ExpresaT V2

## 1. Frontend (Netlify)

El frontend está configurado como Single Page Application (SPA).

1. Sube este repositorio a GitHub.
2. Crea un nuevo sitio en Netlify vinculado a tu repositorio.
3. El `netlify.toml` automáticamente gestionará las redirecciones al `index.html`.
4. No necesitas comando de build a menos que posteriormente integres Vite/Webpack.
5. El directorio a publicar es `frontend`.

## 2. Base de Datos (Supabase)

1. En tu proyecto de Supabase, ve al editor de SQL (SQL Editor).
2. Pega y ejecuta el contenido del archivo `supabase/schema.sql`.
3. Esto creará la tabla `profiles`, políticas de seguridad RLS y el trigger para nuevos usuarios.

## 3. Backend (Render / Railway / Heroku)

El backend de FastAPI utiliza WebSockets, por lo que requiere una plataforma que lo soporte.

1. Conecta tu repositorio.
2. Define el comando de inicio: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
3. Asegúrate de configurar las variables de entorno:
   - `SUPABASE_URL`: Tu URL de Supabase.
   - `SUPABASE_KEY`: Tu llave pública anónima o service role.
4. Una vez desplegado, obtén la URL del backend y reemplázala en `frontend/js/app.js` (Línea 17).
   - Ejemplo: `wss://expresat-api.onrender.com/ws`

## Pruebas Locales

```bash
# Iniciar Backend
cd expresat
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Iniciar Frontend
# Usa una extensión como Live Server en VSCode y abre el index.html
```
