"""
Efficacy router for pathogen susceptibility data from guv-calcs.

Provides endpoints for:
- Available filter options (categories, mediums, wavelengths)
- Quick summary for key pathogens (coronavirus, influenza)
- Filtered pathogen data table
- eACH-UV statistics
- Consolidated explore data
"""

from functools import lru_cache

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/efficacy", tags=["Efficacy"])


# === Request/Response Models ===

class EfficacySummaryRequest(BaseModel):
    """Request for quick summary of key pathogens"""
    fluence: float = Field(..., description="Average fluence rate in µW/cm²")
    wavelength: Optional[int] = Field(222, description="UV wavelength (222 or 254)")


class PathogenSummary(BaseModel):
    """Summary for a single pathogen"""
    species: str
    log1_seconds: Optional[float] = Field(None, description="Time to 90% inactivation (1-log)")
    log2_seconds: Optional[float] = Field(None, description="Time to 99% inactivation (2-log)")
    log3_seconds: Optional[float] = Field(None, description="Time to 99.9% inactivation (3-log)")


class EfficacySummaryResponse(BaseModel):
    """Response with inactivation times for key pathogens"""
    pathogens: List[PathogenSummary]
    wavelength: int
    fluence: float


class EfficacyTableRequest(BaseModel):
    """Request for filtered pathogen data table"""
    fluence: float = Field(..., description="Average fluence rate in µW/cm²")
    wavelength: Optional[int] = Field(None, description="Filter by wavelength (222 or 254)")
    medium: Optional[str] = Field(None, description="Filter by medium (Aerosol, Surface, Liquid)")
    category: Optional[str] = Field(None, description="Filter by category (Bacteria, Viruses, etc.)")


class EfficacyTableResponse(BaseModel):
    """Response with filtered pathogen data"""
    columns: List[str]
    rows: List[List]
    count: int


class EfficacyStatsRequest(BaseModel):
    """Request for eACH-UV statistics across pathogens"""
    fluence: float = Field(..., description="Average fluence rate in µW/cm²")
    wavelength: Optional[int] = Field(None, description="Filter by wavelength")
    medium: str = Field("Aerosol", description="Medium filter")


class EfficacyStatsResponse(BaseModel):
    """Response with eACH-UV statistics"""
    each_uv_median: float
    each_uv_min: float
    each_uv_max: float
    pathogen_count: int
    wavelength: Optional[int]
    medium: str


class EfficacyExploreRequest(BaseModel):
    """Request for consolidated explore data"""
    fluence: Optional[float] = Field(None, description="Average fluence rate in µW/cm²")


class EfficacyExploreResponse(BaseModel):
    """Consolidated response for Explore Data modal"""
    categories: List[str]
    mediums: List[str]
    wavelengths: List[int]
    table: EfficacyTableResponse


# === Cached InactivationData ===

@lru_cache(maxsize=16)
def _get_computed_full_df(fluence: float):
    """Cache the expensive compute_all_columns() result keyed by fluence.

    Returns the computed full DataFrame. Since InactivationData.subset()
    mutates instance filter state, callers create a fresh instance and
    inject this cached DataFrame via _get_inactivation_data().
    """
    from guv_calcs.efficacy import InactivationData
    data = InactivationData(fluence=fluence)
    # Access .full_df to trigger _get_filtered_df on unfiltered state,
    # but the computed columns live in _full_df already from __init__
    return data._full_df.copy()


def _get_inactivation_data(fluence: float):
    """Get an InactivationData instance with cached computed columns.

    Creates a normal instance (without fluence to skip compute_all_columns),
    then swaps in the cached pre-computed _full_df.
    """
    from guv_calcs.efficacy import InactivationData
    cached_df = _get_computed_full_df(fluence)
    data = InactivationData()  # No fluence = no expensive computation
    data._full_df = cached_df.copy()
    data._fluence = fluence
    return data


def _build_table_df(data):
    """Extract the table DataFrame with desired columns from an InactivationData instance."""
    df = data.full_df

    desired_cols = [
        "Category", "Species", "Strain", "wavelength [nm]",
        "k1 [cm2/mJ]", "k2 [cm2/mJ]", "% resistant",
        "Medium", "Condition", "Reference", "Link",
        "eACH-UV", "Seconds to 99% inactivation",
    ]
    available_cols = [c for c in desired_cols if c in df.columns]
    df = df[available_cols]
    df = df.where(df.notna(), None)
    return df


# === Endpoints ===

@router.get("/categories")
def get_categories() -> List[str]:
    """Get available organism categories from the efficacy database"""
    try:
        from guv_calcs.efficacy import InactivationData
        return InactivationData.get_valid_categories()
    except Exception as e:
        logger.error(f"Failed to get categories: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get categories: {str(e)}")


@router.get("/mediums")
def get_mediums() -> List[str]:
    """Get available test mediums from the efficacy database"""
    try:
        from guv_calcs.efficacy import InactivationData
        return InactivationData.get_valid_mediums()
    except Exception as e:
        logger.error(f"Failed to get mediums: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get mediums: {str(e)}")


@router.get("/wavelengths")
def get_wavelengths() -> List[int]:
    """Get available wavelengths from the efficacy database"""
    try:
        from guv_calcs.efficacy import InactivationData
        return [int(w) for w in InactivationData.get_valid_wavelengths()]
    except Exception as e:
        logger.error(f"Failed to get wavelengths: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get wavelengths: {str(e)}")


@router.post("/summary", response_model=EfficacySummaryResponse)
def get_efficacy_summary(request: EfficacySummaryRequest):
    """
    Get quick summary: inactivation times for coronavirus and influenza.

    Returns time to 90%, 99%, and 99.9% inactivation for key respiratory pathogens.
    """
    try:
        from guv_calcs.efficacy import InactivationData
        from guv_calcs.efficacy.math import log1, log2, log3
        import pandas as pd

        data = InactivationData(fluence=request.fluence)

        # Subset to aerosol data at specified wavelength
        if request.wavelength:
            data.subset(wavelength=request.wavelength)
        data.subset(medium="Aerosol")

        df = data.table()

        results = []
        target_species = ["Human coronavirus", "Influenza"]

        for species in target_species:
            # Search for matching species (case-insensitive partial match)
            mask = df["Species"].str.contains(species, case=False, na=False)
            rows = df[mask]

            if not rows.empty:
                # Use the first matching row
                row = rows.iloc[0]

                # Get k values
                k1 = row.get("k1 [cm2/mJ]", 0) or 0
                k2 = row.get("k2 [cm2/mJ]", 0) or 0
                f = row.get("f", 0) or 0  # Resistant fraction

                if k1 > 0:
                    try:
                        results.append(PathogenSummary(
                            species=row.get("Species", species),
                            log1_seconds=log1(request.fluence, k1, k2, f),
                            log2_seconds=log2(request.fluence, k1, k2, f),
                            log3_seconds=log3(request.fluence, k1, k2, f),
                        ))
                    except Exception as calc_err:
                        logger.warning(f"Failed to calculate inactivation times for {species}: {calc_err}")
                        results.append(PathogenSummary(species=species))
                else:
                    results.append(PathogenSummary(species=species))
            else:
                # Species not found in database
                results.append(PathogenSummary(species=species))

        return EfficacySummaryResponse(
            pathogens=results,
            wavelength=request.wavelength or 222,
            fluence=request.fluence
        )

    except ImportError as e:
        logger.error(f"guv_calcs efficacy module not available: {e}")
        raise HTTPException(status_code=500, detail="Efficacy module not available")
    except Exception as e:
        logger.error(f"Failed to get efficacy summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get efficacy summary: {str(e)}")


@router.post("/table", response_model=EfficacyTableResponse)
def get_efficacy_table(request: EfficacyTableRequest):
    """
    Get filtered pathogen data table.

    Returns all base columns plus computed columns from the efficacy database,
    filtered by wavelength, medium, and/or category. Uses full_df to avoid
    the display column selection that table() performs.
    """
    try:
        data = _get_inactivation_data(request.fluence)

        # Apply filters
        if request.wavelength:
            data.subset(wavelength=request.wavelength)
        if request.medium:
            data.subset(medium=request.medium)
        if request.category:
            data.subset(category=request.category)

        df = _build_table_df(data)

        return EfficacyTableResponse(
            columns=df.columns.tolist(),
            rows=df.values.tolist(),
            count=len(df)
        )

    except ImportError as e:
        logger.error(f"guv_calcs efficacy module not available: {e}")
        raise HTTPException(status_code=500, detail="Efficacy module not available")
    except Exception as e:
        logger.error(f"Failed to get efficacy table: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get efficacy table: {str(e)}")


@router.post("/stats", response_model=EfficacyStatsResponse)
def get_efficacy_stats(request: EfficacyStatsRequest):
    """
    Get eACH-UV statistics across pathogens.

    Returns median, min, and max eACH-UV values for the filtered dataset.
    """
    try:
        import numpy as np

        data = _get_inactivation_data(request.fluence)

        # Apply filters
        if request.wavelength:
            data.subset(wavelength=request.wavelength)
        data.subset(medium=request.medium)

        df = data.table()

        # Calculate eACH-UV for each pathogen
        # eACH-UV = fluence * k * 3.6 (convert µW/cm² to mJ/cm²/hr)
        k_col = "k1 [cm2/mJ]"
        if k_col in df.columns:
            k_values = df[k_col].dropna()
            if len(k_values) > 0:
                each_values = request.fluence * k_values * 3.6

                return EfficacyStatsResponse(
                    each_uv_median=float(np.median(each_values)),
                    each_uv_min=float(np.min(each_values)),
                    each_uv_max=float(np.max(each_values)),
                    pathogen_count=len(k_values),
                    wavelength=request.wavelength,
                    medium=request.medium
                )

        # No data found
        return EfficacyStatsResponse(
            each_uv_median=0,
            each_uv_min=0,
            each_uv_max=0,
            pathogen_count=0,
            wavelength=request.wavelength,
            medium=request.medium
        )

    except ImportError as e:
        logger.error(f"guv_calcs efficacy module not available: {e}")
        raise HTTPException(status_code=500, detail="Efficacy module not available")
    except Exception as e:
        logger.error(f"Failed to get efficacy stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get efficacy stats: {str(e)}")


@router.post("/explore", response_model=EfficacyExploreResponse)
def get_explore_data(request: EfficacyExploreRequest):
    """
    Consolidated endpoint for the Explore Data modal.

    Returns metadata (categories, mediums, wavelengths) and the full table
    in a single response, avoiding 4 separate round-trips.
    """
    try:
        from guv_calcs.efficacy import InactivationData

        # Metadata via lightweight classmethods (no instantiation)
        categories = InactivationData.get_valid_categories()
        mediums = InactivationData.get_valid_mediums()
        wavelengths = [int(w) for w in InactivationData.get_valid_wavelengths()]

        # Table data via cached InactivationData (or base data without fluence)
        if request.fluence is not None:
            data = _get_inactivation_data(request.fluence)
        else:
            data = InactivationData()
        df = _build_table_df(data)

        table = EfficacyTableResponse(
            columns=df.columns.tolist(),
            rows=df.values.tolist(),
            count=len(df)
        )

        return EfficacyExploreResponse(
            categories=categories,
            mediums=mediums,
            wavelengths=wavelengths,
            table=table
        )

    except ImportError as e:
        logger.error(f"guv_calcs efficacy module not available: {e}")
        raise HTTPException(status_code=500, detail="Efficacy module not available")
    except Exception as e:
        logger.error(f"Failed to get explore data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get explore data: {str(e)}")
