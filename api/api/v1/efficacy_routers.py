"""
Efficacy router for pathogen susceptibility data from guv-calcs.

Provides endpoints for:
- Available filter options (categories, mediums, wavelengths)
- Quick summary for key pathogens (coronavirus, influenza)
- Filtered pathogen data table
- Plot generation (swarm plot, survival curves)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
import logging
import io
import base64

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


class EfficacyPlotRequest(BaseModel):
    """Request for efficacy plots"""
    fluence: float = Field(..., description="Average fluence rate in µW/cm²")
    wavelength: Optional[int] = Field(None, description="Filter by wavelength")
    medium: Optional[str] = Field(None, description="Filter by medium")
    air_changes: float = Field(1.0, description="Room air changes per hour")


class EfficacyPlotResponse(BaseModel):
    """Response with base64-encoded plot image"""
    image_base64: str
    content_type: str = "image/png"


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


# === Endpoints ===

@router.get("/categories")
def get_categories() -> List[str]:
    """Get available organism categories from the efficacy database"""
    try:
        from guv_calcs.efficacy import InactivationData
        data = InactivationData()
        df = data.table()
        if "Category" in df.columns:
            categories = df["Category"].dropna().unique().tolist()
            return sorted(categories)
        return []
    except Exception as e:
        logger.error(f"Failed to get categories: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get categories: {str(e)}")


@router.get("/mediums")
def get_mediums() -> List[str]:
    """Get available test mediums from the efficacy database"""
    try:
        from guv_calcs.efficacy import InactivationData
        data = InactivationData()
        df = data.table()
        if "Medium" in df.columns:
            mediums = df["Medium"].dropna().unique().tolist()
            return sorted(mediums)
        return []
    except Exception as e:
        logger.error(f"Failed to get mediums: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get mediums: {str(e)}")


@router.get("/wavelengths")
def get_wavelengths() -> List[int]:
    """Get available wavelengths from the efficacy database"""
    try:
        from guv_calcs.efficacy import InactivationData
        data = InactivationData()
        df = data.table()
        if "Wavelength" in df.columns:
            wavelengths = df["Wavelength"].dropna().unique().tolist()
            return sorted([int(w) for w in wavelengths if w])
        return [222, 254]  # Default wavelengths
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

    Returns columns and rows from the efficacy database, filtered by
    wavelength, medium, and/or category.
    """
    try:
        from guv_calcs.efficacy import InactivationData

        data = InactivationData(fluence=request.fluence)

        # Apply filters
        if request.wavelength:
            data.subset(wavelength=request.wavelength)
        if request.medium:
            data.subset(medium=request.medium)
        if request.category:
            data.subset(category=request.category)

        df = data.table()

        # Convert to list format for JSON serialization
        columns = df.columns.tolist()
        rows = df.values.tolist()

        return EfficacyTableResponse(
            columns=columns,
            rows=rows,
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
        from guv_calcs.efficacy import InactivationData
        import numpy as np

        data = InactivationData(fluence=request.fluence)

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


@router.post("/plot/swarm", response_model=EfficacyPlotResponse)
def get_swarm_plot(request: EfficacyPlotRequest):
    """
    Generate K-value swarm plot as PNG image.

    Returns base64-encoded PNG of the swarm plot showing k-value distribution.
    """
    try:
        from guv_calcs.efficacy import InactivationData
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend
        import matplotlib.pyplot as plt

        data = InactivationData(fluence=request.fluence)

        # Apply filters
        if request.wavelength:
            data.subset(wavelength=request.wavelength)
        if request.medium:
            data.subset(medium=request.medium)

        # Generate plot
        fig = data.plot_swarm(air_changes=request.air_changes)

        # Save to buffer
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        plt.close(fig)

        return EfficacyPlotResponse(
            image_base64=base64.b64encode(buf.getvalue()).decode('utf-8')
        )

    except ImportError as e:
        logger.error(f"guv_calcs efficacy module or matplotlib not available: {e}")
        raise HTTPException(status_code=500, detail="Plot generation not available")
    except Exception as e:
        logger.error(f"Failed to generate swarm plot: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate swarm plot: {str(e)}")


@router.post("/plot/survival", response_model=EfficacyPlotResponse)
def get_survival_plot(request: EfficacyPlotRequest):
    """
    Generate survival curve plot as PNG image.

    Returns base64-encoded PNG of survival fraction curves over time.
    """
    try:
        from guv_calcs.efficacy import InactivationData
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend
        import matplotlib.pyplot as plt

        data = InactivationData(fluence=request.fluence)

        # Apply filters
        if request.wavelength:
            data.subset(wavelength=request.wavelength)
        if request.medium:
            data.subset(medium=request.medium)

        # Generate plot (assuming Data has a plot_survival method)
        # If not available, we'll create a simple one
        try:
            fig = data.plot_survival()
        except AttributeError:
            # Create a simple survival plot if method doesn't exist
            fig, ax = plt.subplots(figsize=(10, 6))
            ax.set_xlabel("Time (seconds)")
            ax.set_ylabel("Survival Fraction")
            ax.set_title("Pathogen Survival Curves")
            ax.text(0.5, 0.5, "Survival plot not available",
                    ha='center', va='center', transform=ax.transAxes)

        # Save to buffer
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        plt.close(fig)

        return EfficacyPlotResponse(
            image_base64=base64.b64encode(buf.getvalue()).decode('utf-8')
        )

    except ImportError as e:
        logger.error(f"guv_calcs efficacy module or matplotlib not available: {e}")
        raise HTTPException(status_code=500, detail="Plot generation not available")
    except Exception as e:
        logger.error(f"Failed to generate survival plot: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate survival plot: {str(e)}")
