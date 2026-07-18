"""
MarketLens ETL Microservice
============================
FastAPI application that executes the 4-step financial data pipeline:
  Extract → Transform → Validate → Load

Start with:  uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.jobs import router as jobs_router

app = FastAPI(
    title="MarketLens ETL Service",
    description="Financial data pipeline: Extract → Transform → Validate → Load",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(jobs_router)

@app.get("/")
async def root():
    return {
        "service": "MarketLens ETL",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/jobs/health",
    }
