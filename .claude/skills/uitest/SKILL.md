---
name: uitest
description: "Teste un flux de l'application dans le navigateur via le subagent ui-tester (Sonnet). Usage : /uitest <description du flux à tester>"
context: fork
agent: ui-tester
argument-hint: <flux ou page à tester>
disable-model-invocation: true
---

Teste le flux suivant dans l'application : $ARGUMENTS

Suis ta méthode habituelle (préparation des serveurs, connexion, scénario, contrôle
console/réseau) et rends ton rapport PASS/FAIL.
