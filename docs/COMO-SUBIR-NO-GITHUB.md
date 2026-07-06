# Como subir este projeto no GitHub

Repositorio remoto:

```text
https://github.com/ftsmazzo/campanha360-ai
```

## Caminho recomendado

Extraia o pacote `campanha360-ai-repo.zip`, entre na pasta e rode:

```bash
cd campanha360-ai-repo
git status
git remote -v
git push -u origin main
```

O repositorio local ja tem commits e o remote `origin` configurado para:

```text
https://github.com/ftsmazzo/campanha360-ai.git
```

## Se o remote nao existir

Use:

```bash
git remote add origin https://github.com/ftsmazzo/campanha360-ai.git
git push -u origin main
```

## Se o GitHub pedir login

Autentique pelo metodo que voce ja usa localmente:

- GitHub Desktop;
- token pessoal;
- Git Credential Manager;
- Cursor/VS Code com GitHub conectado.

## Depois do push

Abra o repositorio no Cursor e leia:

1. `README.md`
2. `docs/CURSOR-CONTEXTO.md`
3. `docs/ARQUITETURA.md`
4. `docs/fases/00-BOOTSTRAP.md`
5. `docs/PRIMEIRO-PROMPT-CURSOR.md`

