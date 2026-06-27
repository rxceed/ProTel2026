from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_env: str = "development"
    port: int = 8002
    log_level: str = "info"

    # Database
    database_url: str

    # Cloudflare R2 (dipakai GDAL via env — tidak perlu boto3)
    aws_s3_endpoint: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_virtual_hosting: str = "FALSE"
    aws_region: str = "auto"

    # R2 bucket
    r2_bucket_name: str = "awd-orthomosaic"

    # Server 1 callback URL
    server1_url: str = "http://localhost:3000"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
