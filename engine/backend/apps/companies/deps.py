"""What the Companies routes share: which projects' companies this person may see."""

from typing import Annotated

from fastapi import Depends, Request

from core.api.access import SignedInDep, can_use
from core.company_leads import CompanyLeads


async def visible_leads(request: Request, auth: SignedInDep) -> list[CompanyLeads]:
    """The projects whose companies this person may see: those whose tick they have."""
    specs = getattr(request.app.state, "apps", [])
    return [
        spec.company_leads
        for spec in specs
        if spec.company_leads is not None and can_use(auth, spec.name)
    ]


LeadsDep = Annotated[list[CompanyLeads], Depends(visible_leads)]
