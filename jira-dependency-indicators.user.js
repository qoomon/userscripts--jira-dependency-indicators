// ==UserScript==
// @name         Jira Card Dependency Indicator
// @namespace    https://qoomon.github.io
// @version      1.0.1
// @updateURL    https://github.com/qoomon/userscript-jira-dependency-indicators/raw/main/aws-visual-account-indicator.user.js
// @downloadURL  https://github.com/qoomon/userscript-jira-dependency-indicators/raw/main/aws-visual-account-indicator.user.js
// @description  try to take over the world!
// @author       qoomonu
// @match        https://*.atlassian.net/jira/core/projects/*/board
// @match        https://*.atlassian.net/jira/core/projects/*
// @match        https://*.atlassian.net/jira/software/c/projects/*/boards/*
// @match        https://*.atlassian.net/jira/software/c/projects/*
// @icon         https://www.atlassian.com/favicon.ico
// @grant        none
// ==/UserScript==

window.history.pushState = new Proxy(window.history.pushState, {
  apply: (target, thisArg, argArray) => {
    const result = target.apply(thisArg, argArray)
    window.dispatchEvent(new Event('pushstate'))
    window.dispatchEvent(new Event('changestate'))
    return result
  }
})

window.history.replaceState = new Proxy(window.history.replaceState, {
  apply: (target, thisArg, argArray) => {
    const result = target.apply(thisArg, argArray)
    window.dispatchEvent(new Event('replacestate'))
    window.dispatchEvent(new Event('changestate'))
    return result
  }
})

window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('changestate'));
})

// ------------------------------------------------------------------------------------------------

window.addEventListener('changestate', async () => {
    'use strict';

    if(!document.location.pathname.match(/^\/jira\/core\/projects\/[^/]+\/board$/)
    && !document.location.pathname.match(/^\/jira\/software\/c\/projects\/[^/]+\/boards\/[^/]+$/)) {
       console.info("ignore", document.location.pathname)
       return
    }

    function detectProjectType() {
        if(document.location.pathname.startsWith('/jira/core')) {
            console.log('team managed project detected');
            return 'team'
        }
        if(document.location.pathname.startsWith('/jira/software')) {
            console.log('company managed project detected');
            return 'company'
        }
    }

    const projectType = detectProjectType()
    const projectKey = document.location.pathname.match(/\/projects\/(?<project>[^/]+)\//).groups.project

    const issueDataCache = {}
    async function fetchIssueData(keys) {

        const result = []
        const newKeys = []
        keys.forEach(key => {
            const issueData = issueDataCache[key]
            if(issueData) result.push(issueData)
            else newKeys.push(key)
        })

        if(newKeys.length === 0) return result

        console.info(`fetch issues ${newKeys.join(', ')}`);

        // TODO handle pagination
        const issues = await fetch(`${window.location.origin}/rest/api/3/search/?jql=${encodeURIComponent(`key in (${newKeys.join(',')})`)}&fields=issuelinks`)
        .then(res => res.json()).then(data => data.issues)

        issues.forEach(issue => {
            const issuelinks = issue.fields.issuelinks.map(normalizeIssueLink)

            const internalIssueLinks = issuelinks.filter(link => getProjectKey(link.issue.key) === projectKey)
            issue.internalBlockingIssues = internalIssueLinks.filter(isUnresolvedBlocker).map(link => link.issue)
            if(issue.internalBlockingIssues.length > 0) console.info(issue.key + ' has internal dependencies')

            const externalIssueLinks = issuelinks.filter(link => getProjectKey(link.issue.key) !== projectKey)
            issue.externalBlockingIssues = externalIssueLinks.filter(isUnresolvedBlocker).map(link => link.issue)
            if(issue.externalBlockingIssues.length > 0) console.info(issue.key + ' has external dependencies')
        })

        issues.forEach(issue => {
            issueDataCache[issue.key] = issue
            result.push(issue)
        })
        return result
    }

    function normalizeIssueLink(link) {
        if(link.inwardIssue) {
            link.type.relation = link.type.inward
            link.issue = link.inwardIssue
        }
        if(link.outwardIssue) {
            link.type.relation = link.type.outward
            link.issue = link.outwardIssue
        }
        return link
    }

    function isUnresolvedBlocker(link) {
        return link.type.name === 'Blocks' && link.type.relation === 'is blocked by'
        && link.issue.fields.status.statusCategory.name !== 'Done'
    }

    function getProjectKey(issueKey) {
        return issueKey.split('-')[0]
    }

    function getBoardCards() {
        if(projectType === 'team') {
            const projectKey = document.location.pathname.match(/\/projects\/(?<project>[^/]+)\//).groups.project
            return [...document.querySelectorAll('div[data-rbd-draggable-id^="ISSUE::"]')].map(element => ({
                key: [...element.querySelectorAll('span')].find(e => e.innerText.startsWith(`${projectKey}-`)).innerText,
                element
            }))
        }
        if(projectType === 'company') {
            return [...document.querySelectorAll('.ghx-issue')].map(element => ({
                key: element.getAttribute('data-issue-key'),
                element
            }))
        }
    }

    function getBoardElement() {
        if(projectType === 'team') {
            return document.querySelector('#ak-main-content > div > div > div > div:last-child')
        }
        if(projectType === 'company') {
            return document.querySelector('#ghx-work')
        }
    }

    function createCornerSvg(color) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg",'svg');
        svg.innerHTML = `<polygon points="0,0 0,16 16,0"></polygon>`
        svg.style.cssText = `
            fill: ${color};
            position: absolute;
            top: 0;
            left: 0;
            borderRadius: 2px;
        `
        return svg
    }

    async function untilDefined(fn) {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const result = fn()
                if (result != undefined) {
                    clearInterval(interval)
                    resolve(result)
                }
            }, 100)
        })
    }
    // -----------------------------------------------------------------------------

    async function updateCards() {
        const boardCards = getBoardCards()
        const newCards = boardCards.filter(card => !card.element.issue)
        await fetchIssueData(newCards.map(card => card.key))
        newCards.forEach(card => {
            const issueData = issueDataCache[card.key]
            card.element.issue = issueData // flag element

            if(issueData.internalBlockingIssues.length > 0){
                const cornerSvg = createCornerSvg('#ffab00')
                cornerSvg.setAttribute('title', 'Issue has internal dependencies') // TODO
                card.element.appendChild(cornerSvg)
            }

            if(issueData.externalBlockingIssues.length > 0){
                const cornerSvg = createCornerSvg('#ff5631')
                cornerSvg.setAttribute('title', 'Issue has external dependencies') // TODO
                card.element.appendChild(cornerSvg)
            }
        })
    }

    console.debug('wait for board loaded...')
    const boardElement = await untilDefined(() => getBoardElement())
    console.debug('...board loaded!', boardElement)

    await updateCards()

    const observer = new MutationObserver(async (mutations) => {
        const nodesAdded = mutations.some(mutation => mutation.addedNodes.length > 0)
        if(nodesAdded) await updateCards()
    })
    observer.observe(boardElement, { childList: true, subtree: true })
})
