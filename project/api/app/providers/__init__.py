from .mock_provider import MockProvider
from .alpha_vantage import AlphaVantageProvider
from .fmp import FMPProvider

PROVIDERS = {
    "MOCK": MockProvider(),
    "ALPHA_VANTAGE": AlphaVantageProvider(),
    "FMP": FMPProvider(),
}

def get_provider(name: str):
    return PROVIDERS.get(name.upper(), PROVIDERS["MOCK"])
