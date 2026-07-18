from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Service auth – Next.js sends this header on every request
    api_key: str = "dev-etl-key"

    # CORS origin(s) – the Next.js frontend URL(s)
    cors_origins: list[str] = ["http://localhost:3000"]

    # Market data providers (optional – MOCK works with no keys)
    market_data_provider: str = "MOCK"
    alpha_vantage_api_key: str = ""
    fmp_api_key: str = ""

settings = Settings()
