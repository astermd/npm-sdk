.PHONY: install lint fix typecheck test coverage build ci

install:
	npm install

lint:
	npm run lint

fix:
	npm run fix

typecheck:
	npm run typecheck

test:
	npm test

coverage:
	npm run coverage

build:
	npm run build

ci:
	npm run ci
