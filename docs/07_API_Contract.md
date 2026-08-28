# API Contract
## LinkedIn Profile API — Tross Hiring Challenge

*(Bonus document — not explicitly requested, but essential: this is the single source of truth the LLD, Formatter, and README all point back to. Worth including in the repo as `docs/API_CONTRACT.md`.)*

---

## 1. Endpoint: Fetch Profile

**Request**

```
POST /api/v1/profile
Content-Type: application/json
```

```json
{
  "linkedin_url": "https://www.linkedin.com/in/example-profile"
}
```

**Success Response — 200 OK**

```json
{
  "status": "success",
  "data": {
    "name": "Jane Doe",
    "headline": "Senior Software Engineer at Example Co.",
    "location": "Bengaluru, India",
    "about": "Experienced engineer specializing in...",
    "experience": [
      {
        "title": "Senior Software Engineer",
        "company": "Example Co.",
        "duration": "2022 - Present",
        "location": "Bengaluru, India",
        "description": "Led development of..."
      }
    ],
    "education": [
      {
        "school": "Example University",
        "degree": "B.Tech, Computer Science",
        "duration": "2016 - 2020"
      }
    ],
    "skills": ["TypeScript", "Node.js", "System Design"],
    "certifications": [
      {
        "name": "Example Certification",
        "issuer": "Example Org",
        "date": "2023"
      }
    ],
    "languages": ["English", "Hindi"],
    "images": {
      "profile_photo": "https://.../photo.jpg",
      "banner": null
    }
  },
  "meta": {
    "source": "cache",
    "fetched_at": "2026-08-28T10:15:00Z"
  }
}
```

**Field convention:** a field that exists on the profile but is empty is returned as `null` (objects) or `[]` (arrays that exist but have no entries). A section that LinkedIn does not expose at all for this profile is omitted from the object entirely. This convention is documented once here and applied consistently by the Formatter.

## 2. Endpoint: Job Status (only if async mode is implemented)

```
GET /api/v1/profile/status/:jobId
```

```json
{
  "status": "processing",
  "jobId": "abc123"
}
```

or, once complete, the same shape as the success response above.

## 3. Error Response Shape (applies to all endpoints)

```json
{
  "status": "error",
  "error": {
    "code": "PROFILE_PRIVATE_OR_UNREACHABLE",
    "message": "This profile's data could not be retrieved.",
    "http_status": 422
  }
}
```

## 4. Error Codes Reference

| Code | HTTP Status | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | Input is not a valid LinkedIn profile URL |
| `PROFILE_NOT_FOUND` | 404 | Profile does not exist |
| `PROFILE_PRIVATE_OR_UNREACHABLE` | 422 | Profile exists but data isn't accessible |
| `UPSTREAM_RATE_LIMITED` | 429 | Extraction layer is currently throttled |
| `EXTRACTION_TIMEOUT` | 504 | Extraction took too long |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

## 5. Health Check

```
GET /health
```

```json
{ "status": "ok" }
```
