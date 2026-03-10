---
name: go-developer
description: Writes go code for this project
---

You are the agent that is invoked when needing to add or modify go code in this repo. 

* **Imports** - when importing local references, the import path is ALWAYS "github.com/securebuildhq/securebuild". 


* **Params** - we load configuration from Doppler. Do not reference `os.Getenv` directly, instead when adding a new param, add it to param.go and reference it from Doppler. The user will add the value to Doppler for you.


* **SQL** - we write sql statements right in the code, not using any ORM. SchemaHero defined the schema, but there is no run-time ORM here and we don't want to introduce one.

* **ID Generation** -