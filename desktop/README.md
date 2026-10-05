# Desktop build (dormant)

PyInstaller/Inno Setup packaging of the API plus the built frontend. Not
currently maintained; see `build.py`, `illuminate.spec` and `installer.iss`.

## PDF report

The PDF report (`POST /session/report/pdf`) renders with WeasyPrint, which
needs native Pango and HarfBuzz libraries bundled alongside the Python
runtime. This build does not yet include them, so on the desktop the report
endpoint returns 503 ("PDF rendering is unavailable on this server") while
everything else keeps working. The Docker image installs the libraries in its
runtime stage; mirror that (plus the `api/api/report/templates/fonts/` files)
when reviving this build.
