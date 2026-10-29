# Control de horas extras

Aplicación web en español para registrar jornadas por colaborador, consultar acumulados por período y exportar el detalle a Excel.

## Uso local

1. Abre una terminal en la carpeta del proyecto.
2. Ejecuta `py -m http.server 8000`.
3. Abre `http://localhost:8000` en el navegador.

Sin configuración de Firebase, los datos quedan guardados en el almacenamiento local del navegador y no se comparten entre dispositivos. No borres los datos del navegador si necesitas conservar ese historial.
Los registros locales no se migran automáticamente a Firebase; configura Firebase antes de empezar a guardar datos que deban compartirse.

## Reglas de cálculo

- De lunes a viernes, el horario regular es de 8:00 a. m. a 5:00 p. m.
- El sábado, el horario regular es de 8:00 a. m. a 12:00 p. m.
- Se suman únicamente los minutos trabajados antes de la entrada regular y después de la salida regular.
- El domingo no tiene horario regular definido; por tanto, todo el tiempo registrado ese día se considera extra.
- Se permiten varios registros no traslapados por colaborador y fecha. Una salida anterior a la hora de entrada se interpreta como salida al día siguiente.
- El botón **Iniciar nuevo período** cambia la consulta al día actual; no elimina ni reinicia los registros anteriores.
- Las fechas del período filtran por la fecha de entrada del turno. Los acumulados por colaborador, día y período se calculan a partir de esos registros.
- Al abrir la aplicación, el período inicia en la fecha local de hoy. Para consultar más días, selecciona el rango de fechas deseado.
- La planilla agrega una columna automáticamente por cada fecha entre **Desde** y **Hasta**, ambas inclusive. El último rango seleccionado se recuerda en el mismo navegador; los datos siguen guardados en Firestore.
- El domingo no tiene horario regular: se considera extra todo el tiempo del turno registrado ese día.
- Los colaboradores nuevos se ordenan del más antiguo al más reciente según su fecha de creación. Los colaboradores agregados antes de incorporar este dato se mantienen arriba en el orden existente, ya que no cuentan con una fecha histórica de creación guardada.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub. Si usas la terminal y todavía no has inicializado Git en esta carpeta, ejecuta:

```text
git init
git add .
git commit -m "Publicar control de horas extras"
git branch -M main
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

Reemplaza `USUARIO/REPOSITORIO` con los datos reales del repositorio. Si ya existe un repositorio Git, no repitas `git init`: agrega y sube los cambios con `git add .`, `git commit` y `git push`.

2. En GitHub, abre el repositorio y ve a **Settings → Pages**.
3. En **Build and deployment**, elige **Deploy from a branch**; selecciona la rama `main` y la carpeta `/(root)`, y pulsa **Save**.
4. Espera a que termine la publicación. La dirección será `https://USUARIO.github.io/REPOSITORIO/`. En un repositorio llamado `USUARIO.github.io`, será `https://USUARIO.github.io/`.

Los archivos del sitio se publican desde la raíz del repositorio. No se usa Firebase Hosting ni hace falta instalar Firebase CLI para publicar la página.

## Conectar Firebase (opcional)

La aplicación ya incluye el SDK web de Firebase, autenticación por correo/contraseña, lectura y guardado de personal y horarios en Cloud Firestore, y una plantilla de configuración en `firebase-config.js`. Sin esa configuración usa el almacenamiento local del navegador; esos datos **no se migran automáticamente** a Firebase.

### 1. Crear y configurar Firebase

1. Entra a [Firebase Console](https://console.firebase.google.com/) y crea un proyecto.
2. En **Project settings → General → Your apps**, agrega una aplicación web (`</>`) y copia su objeto de configuración.
3. En **Authentication → Sign-in method**, habilita **Email/Password**.
4. En **Authentication → Settings → Authorized domains**, agrega el dominio de GitHub Pages: `USUARIO.github.io` (sin `https://` ni la ruta del repositorio). Agrega también `localhost` si vas a probar localmente.
5. En **Firestore Database**, crea la base de datos.

Los registros no aparecen como colecciones raíz: se guardan bajo `users/{UID de Firebase}/employees` y `users/{UID de Firebase}/records`. Para consultarlos en la consola, expande primero el documento `users` y el documento con el UID de la cuenta que inició sesión.

### 2. Pegar la configuración web

Abre `firebase-config.js` y reemplaza los valores vacíos del objeto `firebaseConfig` por los de tu aplicación web. El archivo publica automáticamente esa configuración en `window.APP_CONFIG.firebase`, que es donde la aplicación la lee:

```js
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "ID_DE_TU_PROYECTO",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};
```

No reemplaces la última línea del archivo (`window.APP_CONFIG = { firebase: firebaseConfig };`); esa línea conecta el objeto con la aplicación. Sube el archivo al mismo repositorio de GitHub con `git add firebase-config.js`, `git commit -m "Configurar Firebase"` y `git push`. GitHub Pages volverá a publicar el sitio; cuando termine, recarga la página. Al detectar la configuración aparecerá el inicio de sesión.

### Usar el mismo personal en varios dispositivos

1. Crea una sola cuenta con **Crear cuenta** en Firebase Authentication.
2. En cada dispositivo, abre la URL publicada en GitHub Pages e inicia sesión con **ese mismo correo y contraseña**. El encabezado mostrará el correo de la cuenta activa cuando Firebase esté conectado.
3. Agrega colaboradores y guarda horarios después de iniciar sesión. Firestore separa los datos por cuenta: si creas o usas otra cuenta, tendrá una lista de personal independiente.

El inicio de sesión ya está incluido en la aplicación; no necesitas crear otro usuario personalizado. Los colaboradores agregados antes de configurar Firebase permanecen en el almacenamiento local de ese dispositivo y no se copian solos. Agrégalos de nuevo después de iniciar sesión en Firebase, o consérvalos en tu exportación.

La configuración de una aplicación web de Firebase está diseñada para estar en el navegador; `apiKey` no es una contraseña ni otorga por sí sola acceso a los registros. En **Google Cloud Console → APIs & Services → Credentials**, restringe la clave de API al dominio `USUARIO.github.io` (y `localhost` durante las pruebas). Nunca pongas contraseñas de cuentas de servicio o claves privadas en este archivo.

### 3. Proteger Firestore

En Firebase Console, abre **Firestore Database → Rules**, reemplaza las reglas con el contenido de `firestore.rules` y pulsa **Publish**. Estas reglas permiten que cada cuenta autenticada lea y modifique únicamente sus propias colecciones de colaboradores y registros. No uses reglas abiertas, como permitir lectura/escritura a todos.

También puedes publicar solo las reglas con Firebase CLI si lo tienes instalado y ya vinculaste el proyecto: `firebase deploy --only firestore:rules`. Esto no publica el sitio y no requiere configurar Firebase Hosting.

### 4. Verificar la conexión

1. Abre la URL publicada de GitHub Pages y crea una cuenta.
2. Agrega un colaborador, captura horarios y pulsa **Guardar horarios**.
3. Recarga la página e inicia sesión otra vez: el colaborador y los horarios deben seguir ahí.
4. Prueba la misma cuenta en otro navegador o dispositivo. Los datos deben aparecer allí también.

El panel aparece en cuanto Firebase verifica la cuenta; los botones para guardar se habilitan cuando termina de cargar Firestore. El estado superior muestra la cuenta conectada. Al agregar un colaborador, el mensaje confirma si quedó guardado en Firebase o solo en este dispositivo. Si aparece un error de permisos, publica las reglas de Firestore antes de volver a guardar.

Si Firestore no confirma una escritura en 15 segundos, la aplicación mostrará un aviso; una operación sin respuesta podría finalizar más tarde, por lo que conviene recargar y verificar la planilla antes de volver a intentarla. En Firestore → Data, busca `users`, abre el documento cuyo ID es el UID de la cuenta en **Authentication → Users** y, dentro de este, la subcolección `employees`. Los registros de horarios aparecen en `records`.

Si ya tenías información guardada localmente, expórtala primero y consérvala: no se copia automáticamente a Firestore al conectar Firebase.

## Planilla y exportación

La planilla principal muestra una fila por colaborador y grupos de columnas para cada fecha del período: entrada, salida y total de horas extras. Edita directamente las celdas de entrada y salida y pulsa **Guardar horarios**. La tabla muestra también el total por colaborador y la suma general diaria y del período.

El botón **Exportar a Excel** genera una planilla `.xlsx` con el mismo formato tabular, colores, bordes, encabezados de fecha, totales por día y colaborador, además de una hoja de resumen. Se requiere conexión a internet para cargar la biblioteca de exportación incluida en la página.
