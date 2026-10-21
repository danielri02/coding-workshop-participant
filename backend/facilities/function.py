"""Workshop Lambda entrypoint: one packaged FastAPI service for all routes."""

import os

from app.deployment import API_PREFIX
from app.main import app
from mangum import Mangum

# Local Vite strips the service prefix; CloudFront retains it. Mangum accepts
# either path, while root_path keeps Swagger/OpenAPI URLs under the service.
app.root_path = os.environ.get("API_ROOT_PATH", API_PREFIX).rstrip("/")
handler = Mangum(app, lifespan="auto", api_gateway_base_path=app.root_path or "/")
