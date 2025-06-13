# Architectural Diagrams

**Status:** DRAFT
**Version:** 0.2

This directory contains visual diagrams, such as C4 models, sequence diagrams, and infrastructure diagrams, that illustrate the architecture of the platform.

## C4 System Context Diagram

This diagram shows the high-level relationships between the FDA.gov v2 Platform, its users, and the external systems it interacts with.

```mermaid
C4Context
    title System Context diagram for FDA.gov v2 Platform

    Person(patient, "Patient / Trial Participant", "A person using the platform to manage their health data and participate in trials.")
    Person(creator, "Trial Creator / Researcher", "A scientist or institution designing and running a clinical trial.")
    Person(regulator, "Regulator / IRB Member", "An official from the FDA, a peer agency, or an Institutional Review Board (IRB) providing oversight.")
    
    System_Boundary(platform_boundary, "FDA.gov v2 Platform") {
        System(dfda_platform, "FDA.gov v2 Platform", "The core open-source backend (BaaS) for data aggregation, trial management, and evidence generation. Provides APIs, a reference portal, and a public knowledge base.")
    }

    System_Ext(ehr, "EHR / Data Silos", "External Electronic Health Record systems, health apps, and lab systems that are sources of patient data.")
    System_Ext(insurance, "Insurance Underwriters", "Third-party services providing liability insurance for clinical trials.")
    System_Ext(github, "Public Code Repository", "e.g., GitHub. Hosts the open-source code, manages pull requests, and facilitates community contributions.")
    System_Ext(payment, "Payment Gateways", "External services for managing financial transactions for trial participation costs and deposits.")
    System_Ext(national_systems, "National Health Systems", "e.g., NIH All of Us, CDC Surveillance Systems. The platform interoperates with these systems.")

    Rel(patient, dfda_platform, "Contributes data, consents to trials, views findings")
    Rel(creator, dfda_platform, "Designs & manages trials, analyzes results")
    Rel(regulator, dfda_platform, "Monitors trial progress & safety data")

    Rel_L(dfda_platform, ehr, "Pulls data from", "API, FHIR")
    Rel_R(dfda_platform, insurance, "Gets quotes from", "API")
    Rel_R(dfda_platform, github, "Manages source code via", "Git, Webhooks")
    Rel_L(dfda_platform, payment, "Processes payments via", "API")
    Rel_R(dfda_platform, national_systems, "Shares & receives data with", "API, Interoperability Framework")

    UpdateElementStyle(patient, "lightgrey", "black", "black")
    UpdateElementStyle(creator, "lightgrey", "black", "black")
    UpdateElementStyle(regulator, "lightgrey", "black", "black")
    UpdateElementStyle(dfda_platform, "blue", "white", "blue")
```

## C4 Container Diagram

This diagram zooms into the FDA.gov v2 Platform to show its main logical containers (applications, services, and data stores).

```mermaid
C4Container
    title Container diagram for FDA.gov v2 Platform

    Person(patient, "Patient / Trial Participant", "Uses the reference portal to manage data and view findings.")
    Person(creator, "Trial Creator / Researcher", "Uses the reference portal to design and manage trials.")
    System_Ext(ehr, "EHR / Data Silos", "External data sources.")
    System_Ext(github, "Public Code Repository", "Hosts the platform's source code.")

    System_Boundary(platform_boundary, "FDA.gov v2 Platform (Live System)") {
        
        Container(portal, "Reference Web Portal", "TypeScript, Next.js", "Provides the user interface for patients, trial creators, and the public (Clinipedia).")
        Container(api_gateway, "API Gateway", "e.g., AWS API Gateway", "Routes all incoming API requests, handles authentication, rate limiting.")
        
        System_Boundary(api_services, "Backend API Services") {
            Container(ingestion_api, "Ingestion API", "Python, FastAPI", "Handles submission of new observations and files.")
            Container(query_api, "Query API", "Python, FastAPI", "Provides interfaces to retrieve data.")
            Container(user_api, "User & Consent API", "Python, FastAPI", "Manages user profiles and consent records.")
        }
        
        System_Boundary(processing_services, "Asynchronous Processing") {
            Container(worker, "Mapping & Validation Engine", "Python, Dask/Celery", "A pool of workers that asynchronously process, map, and validate ingested data.")
            Container(queue, "Message Queue", "e.g., AWS SQS", "Decouples the Ingestion API from the processing workers.")
        }
        
        System_Boundary(storage_services, "Data Storage") {
            ContainerDb(metadata_db, "Metadata Database", "PostgreSQL", "Stores user profiles, trial info, consent records, variable definitions.")
            ContainerDb(timeseries_db, "Time-Series Database", "TimescaleDB", "Stores all validated health observations.")
            ContainerDb(file_store, "File Storage", "e.g., AWS S3", "Stores raw, unprocessed uploaded files.")
        }

        Rel(patient, portal, "Uses", "HTTPS")
        Rel(creator, portal, "Uses", "HTTPS")
        Rel(portal, api_gateway, "Makes API calls to", "HTTPS/JSON")

        Rel(api_gateway, ingestion_api, "Routes to")
        Rel(api_gateway, query_api, "Routes to")
        Rel(api_gateway, user_api, "Routes to")
        
        Rel(ingestion_api, queue, "Puts jobs in")
        Rel(ingestion_api, file_store, "Writes to")
        Rel(worker, queue, "Pulls jobs from")

        Rel(worker, metadata_db, "Reads variable definitions from")
        Rel(worker, timeseries_db, "Writes validated data to")
        Rel(worker, file_store, "Reads from")

        Rel(query_api, metadata_db, "Reads from")
        Rel(query_api, timeseries_db, "Reads from")

        Rel(user_api, metadata_db, "Reads/Writes to")
    }

    Rel(ingestion_api, ehr, "Fetches data from (via plugins)", "HTTPS/API")
    Rel_R(api_gateway, github, "Receives webhooks from (for CI/CD)", "HTTPS")
    
    UpdateElementStyle(portal, "lightblue")
    UpdateElementStyle(api_gateway, "lightgrey")
```

## Other Diagrams

* **[Layered Platform Architecture](https://static.crowdsourcingcures.org/img/layered-platform-architecture-diagram.png)**: A high-level view of the core platform and plugin framework.
* **[Plugin Marketplace](https://static.crowdsourcingcures.org/img/plugin-marketplace.png)**: Illustrates the relationship between the core platform and the third-party plugin ecosystem.

---
*More diagrams will be added here as they are developed.*
