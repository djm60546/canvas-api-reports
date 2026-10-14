// ==UserScript==
// @name         Canvas API Reports Async
// @namespace    https://github.com/djm60546/canvas-api-reports
// @version      2.00
// @description  Script for extracting student and instructor performance data using the Canvas API. Generates CSV downloads. Refactored to use JavaScript promises, async/await, concurrency limits, and safer per-course state.
// @author       Dan Murphy (dmurphy@northwestern.edu), Northwestern University School of Professional Studies
// @match        https://canvas.northwestern.edu/accounts/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @require      https://code.jquery.com/ui/1.14.2/jquery-ui.min.js
// @grant        none
// ==/UserScript==

(function ($) {
    'use strict';

    // ==============================
    // Configuration
    // ==============================

    var headingNoSpaces = false;
    var showViewStudent = false;

    var controls = {
        aborted: false,
        anonStdnts: true,
        combinedRpt: true,
        canvasAcct: '21',
        courseArray: [],
        courseIndex: 0,
        coursePending: -1,
        dlCrsOnly: true,
        emptyCourse: false,
        nowDate: new Date(),
        nowDateMS: new Date().getTime(),
        rptDateEnd: 0,
        rptDateStart: 0,
        rptDateStartTxt: '',
        rptDateEndTxt: '',
        rptType: 'none',
        atRisk: {
            late: 0,
            mssg: 0,
            time: 0,
            posts: 0,
            scoreRaw: 70.00,
            sbmssn: 0
        },
        lateGradingIntvl: 604800000
    };

    var CONCURRENCY = {
        API: 5,
        COURSES: 2,
        USER_ACCESS: 3,
        TOPICS: 3
    };

    var abortController = null;

    // ==============================
    // Report options
    // ==============================

    var REPORT_TERMS = [
        { val: 0, txt: 'Select a term' },
        { val: 399, txt: '2027 Winter' },
        { val: 398, txt: '2026 Fall' },
        { val: 401, txt: '2026-2027 Academic Year' },
        { val: 397, txt: '2026 Summer' },
        { val: 396, txt: '2026 Spring' },
        { val: 393, txt: '2026 Winter' },
        { val: 392, txt: '2025 Fall' },
        { val: 395, txt: '2025-2026 Academic Year' },
        { val: 394, txt: '2025 Summer' },
        { val: 391, txt: '2025 Spring' },
        { val: 390, txt: '2025 Winter' },
        { val: 389, txt: '2024 Fall' },
        { val: 388, txt: '2024-2025 Academic Year' },
        { val: 287, txt: '2024 Summer' },
        { val: 286, txt: '2024 Spring' },
        { val: 285, txt: '2024 Winter' },
        { val: 284, txt: '2023 Fall' },
        { val: 283, txt: '2023-2024 Academic Year' },
        { val: 281, txt: '2023 Summer' },
        { val: 282, txt: '2023 Spring' },
        { val: 278, txt: '2023 Winter' },
        { val: 280, txt: '2022 Fall' },
        { val: 279, txt: '2022-2023 Academic Year' },
        { val: 277, txt: '2022 Summer' },
        { val: 276, txt: '2022 Spring' },
        { val: 275, txt: '2022 Winter' },
        { val: 274, txt: '2021 Fall' },
        { val: 273, txt: '2021-2022 Academic Year' },
        { val: 271, txt: '2021 Summer' },
        { val: 170, txt: '2021 Spring' },
        { val: 169, txt: '2021 Winter' },
        { val: 168, txt: '2020 Fall' },
        { val: 167, txt: '2020-2021 Academic Year' },
        { val: 166, txt: '2020 Summer' },
        { val: 165, txt: '2020 Spring' },
        { val: 164, txt: '2020 Winter' },
        { val: 163, txt: '2019 Fall' },
        { val: 129, txt: '2019-2020 Academic Year' },
        { val: 131, txt: '2019-2020 Academic Year' },
        { val: 128, txt: '2019 Summer' },
        { val: 127, txt: '2019 Spring' },
        { val: 124, txt: '2019 Winter' },
        { val: 126, txt: '2018 Fall' },
        { val: 125, txt: '2018-2019 Med Academic Year' },
        { val: 130, txt: '2018-2019 Academic Year' },
        { val: 123, txt: '2018 Summer' },
        { val: 122, txt: '2018 Spring' },
        { val: 121, txt: '2018 Winter' },
        { val: 120, txt: '2017 Fall' },
        { val: 118, txt: '2017-2018 Academic Year' },
        { val: 119, txt: '2017 Summer' },
        { val: 113, txt: '2017 Spring' },
        { val: 112, txt: '2017 Winter' },
        { val: 111, txt: '2016 Fall' },
        { val: 109, txt: '2016-2017 Academic Year' },
        { val: 110, txt: '2016 Summer' },
        { val: 107, txt: '2016 Spring' },
        { val: 106, txt: '2016 Winter' },
        { val: 105, txt: '2015 Fall' },
        { val: 108, txt: '2015-2016 Academic Year' },
        { val: 103, txt: '2015 Summer' },
        { val: 93, txt: '2015 Spring' },
        { val: 96, txt: '2015 Winter' },
        { val: 92, txt: '2014 Fall' },
        { val: 104, txt: '2014-2015 Academic Year' },
        { val: 115, txt: 'Advising Term' },
        { val: 1, txt: 'Default Term' },
        { val: 116, txt: 'Demo Term' },
        { val: 114, txt: 'Prep Site Term' },
        { val: 117, txt: 'Program Term' }
    ];

    var REPORT_TYPES = [
        { val: '0', txt: 'Select a report type' },
        { val: 'at-risk', txt: 'At-risk Students' },
        { val: 'access', txt: 'Course Resource Access' },
        { val: 'final-grade', txt: 'Final Grades' },
        { val: 'instructor', txt: 'Instructor Presence' },
        { val: 'participation', txt: 'Zero Participation' }
    ];

    // ==============================
    // General utilities
    // ==============================

    function errorHandler(e) {
        console.log(e.name + ': ' + e.message);
        if (e.stack) {
            console.log(e.stack);
        }

        if (e.name !== 'AbortError') {
            alert('An error occurred. See browser console for details.');
        }

        abortAll();
    }

    function abortAll() {
        controls.aborted = true;

        if (abortController) {
            abortController.abort();
        }
        resetUI();
    }

    function nextURL(linkTxt) {
        var url = null;

        if (linkTxt) {
            var links = linkTxt.split(',');
            var nextRegEx = new RegExp('^\\s*<(.*)>; rel="next"\\s*$');

            for (var i = 0; i < links.length; i++) {
                var matches = nextRegEx.exec(links[i]);
                if (matches) {
                    url = matches[1];
                    break;
                }
            }
        }

        return url;
    }

    function createLimiter(maxConcurrent) {
        var active = 0;
        var queue = [];

        function runNext() {

            while (active < maxConcurrent && queue.length > 0) {

                var item = queue.shift();

                active++;

                Promise.resolve()
                    .then(item.fn)
                    .then(item.resolve)
                    .catch(item.reject)
                    .finally(function () {

                    active--;

                    runNext();

                });
            }
        }

        function limit(fn) {

            return new Promise(function (resolve, reject) {

                queue.push({
                    fn: fn,
                    resolve: resolve,
                    reject: reject
                });

                runNext();

            });
        }

        limit.setMax = function (newMax) {

            maxConcurrent = Math.max(1, newMax);

            runNext();
        };

        limit.getMax = function () {

            return maxConcurrent;
        };

        return limit;
    }

    var apiLimit = createLimiter(CONCURRENCY.API);

    var MAX_API_RETRIES = 5;

    var throttleControl = {
        lastConcurrencyReductionMS: 0,
        reductionCooldownMS: 30000
    };

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function parseRetryAfterMs(response) {
        var retryAfter = response.headers.get('Retry-After');

        if (!retryAfter) {
            return null;
        }

        var retryAfterSeconds = Number(retryAfter);

        if (!isNaN(retryAfterSeconds)) {
            return retryAfterSeconds * 1000;
        }

        var retryAfterDateMS = Date.parse(retryAfter);

        if (!isNaN(retryAfterDateMS)) {
            return Math.max(0, retryAfterDateMS - Date.now());
        }

        return null;
    }

    function getRetryDelayMs(response, attempt) {
        var retryAfterMs = parseRetryAfterMs(response);

        if (retryAfterMs !== null) {
            return retryAfterMs;
        }

        var baseDelayMS = 1000;
        var maxDelayMS = 60000;

        var exponentialDelayMS = Math.min(
            maxDelayMS,
            baseDelayMS * Math.pow(2, attempt)
        );

        var jitterMS = Math.floor(Math.random() * 500);

        return exponentialDelayMS + jitterMS;
    }

    function isRateLimitForbidden(responseText) {
        if (!responseText) {
            return false;
        }

        return /rate limit|rate-limit|too many requests|throttl/i.test(responseText);
    }

    function isRetryableCanvasError(status, responseText) {
        if (status === 429) {
            return true;
        }

        if (status === 403 && isRateLimitForbidden(responseText)) {
            return true;
        }

        return (
            status === 408 ||
            status === 500 ||
            status === 502 ||
            status === 503 ||
            status === 504
        );
    }

    function shouldReduceConcurrency(status, responseText) {
        return (
            status === 429 ||
            (status === 403 && isRateLimitForbidden(responseText))
        );
    }

    function reduceApiConcurrencyAfterThrottle(status, url) {
        var nowMS = Date.now();

        if (
            nowMS - throttleControl.lastConcurrencyReductionMS <
            throttleControl.reductionCooldownMS
        ) {
            return;
        }

        if (CONCURRENCY.API <= 1) {
            return;
        }

        CONCURRENCY.API = Math.max(1, CONCURRENCY.API - 1);

        if (apiLimit && typeof apiLimit.setMax === 'function') {
            apiLimit.setMax(CONCURRENCY.API);
        }

        throttleControl.lastConcurrencyReductionMS = nowMS;

        console.warn(
            'Canvas throttling detected. Reduced API concurrency to ' +
            CONCURRENCY.API +
            '. Status: ' +
            status +
            '. URL: ' +
            url
        );
    }


  async function mapWithLimit(items, maxConcurrent, asyncFn) {
        var limiter = createLimiter(maxConcurrent);

        var jobs = items.map(function (item, index) {
            return limiter(function () {
                return asyncFn(item, index);
            });
        });

        return Promise.all(jobs);
    }

    async function canvasFetchPage(url) {
        if (controls.aborted) {
            throw new Error('Report aborted');
        }

        var lastError = null;

        for (var attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
            var response = null;
            var responseText = '';

            try {
                response = await apiLimit(function () {
                    return fetch(url, {
                        method: 'GET',
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json'
                        },
                        signal: abortController ? abortController.signal : undefined
                    });
                });
            } catch (e) {
                if (e.name === 'AbortError') {
                    throw e;
                }

                lastError = e;

                if (attempt >= MAX_API_RETRIES) {
                    throw new Error(
                        'Canvas API network error after ' +
                        MAX_API_RETRIES +
                        ' retries for ' +
                        url +
                        ': ' +
                        e.message
                    );
                }

                var networkDelayMS =
                    Math.min(60000, 1000 * Math.pow(2, attempt)) +
                    Math.floor(Math.random() * 500);

                console.warn(
                    'Canvas API network error. Retrying attempt ' +
                    (attempt + 1) +
                    ' of ' +
                    MAX_API_RETRIES +
                    ' in ' +
                    networkDelayMS +
                    'ms. URL: ' +
                    url,
                    e
                );

                await sleep(networkDelayMS);
                continue;
            }

            if (response.ok) {
                var data = await response.json();
                var linkHeader = response.headers.get('Link');

                return {
                    data: data,
                    next: nextURL(linkHeader)
                };
            }

            try {
                responseText = await response.clone().text();
            } catch (e2) {
                responseText = '';
            }

            var retryable = isRetryableCanvasError(
                response.status,
                responseText
            );

            if (!retryable) {
                throw new Error(
                    'Canvas API error ' +
                    response.status +
                    ' for ' +
                    url +
                    '. This status is not retryable. Response: ' +
                    responseText.substring(0, 500)
                );
            }

            if (shouldReduceConcurrency(response.status, responseText)) {
                reduceApiConcurrencyAfterThrottle(
                    response.status,
                    url
                );
            }

            if (attempt >= MAX_API_RETRIES) {
                throw new Error(
                    'Canvas API error ' +
                    response.status +
                    ' after ' +
                    MAX_API_RETRIES +
                    ' retries for ' +
                    url +
                    '. Response: ' +
                    responseText.substring(0, 500)
                );
            }

            var waitMS = getRetryDelayMs(response, attempt);

            console.warn(
                'Canvas API retryable error ' +
                response.status +
                '. Retrying attempt ' +
                (attempt + 1) +
                ' of ' +
                MAX_API_RETRIES +
                ' in ' +
                waitMS +
                'ms. URL: ' +
                url
            );

            await sleep(waitMS);
        }

        throw (
            lastError ||
            new Error(
                'Canvas API request failed for ' +
                url
            )
        );
    }

    async function canvasFetchAllPages(url) {
        var results = [];
        var next = url;

        while (next) {
            var page = await canvasFetchPage(next);

            if (Array.isArray(page.data)) {
                results = results.concat(page.data);
            } else if (page.data) {
                results.push(page.data);
            }

            next = page.next;
        }

        return results;
    }

    function firstRegexMatch(regex, value, fallback) {
        if (!value) {
            return fallback;
        }

        var match = regex.exec(value);
        if (!match) {
            return fallback;
        }
        return match[0] || fallback;
    }

    function roundTwo(value) {
        return Math.round(value * 100) / 100;
    }

    function getObjectValues(obj) {
        return Object.keys(obj).map(function (key) {
            return obj[key];
        });
    }

    function reportingPeriodIsActive() {
        return (
            controls.rptDateStart > 0 &&
            controls.rptDateEnd > 0 &&
            !isNaN(controls.rptDateStart) &&
            !isNaN(controls.rptDateEnd)
        );
    }

    function dateIsInReportingPeriod(dateValue) {
        if (!reportingPeriodIsActive()) {
            return true;
        }

        var dateMS =
            typeof dateValue === 'number'
        ? dateValue
        : new Date(dateValue).getTime();

        if (isNaN(dateMS)) {
            return false;
        }

        return (
            dateMS >= controls.rptDateStart &&
            dateMS <= controls.rptDateEnd
        );
    }

    // Remove references to sensitive Canvas data so browser garbage collection can reclaim memory.
    //
    // @param {Object} ctx Course context.

    function destroyCourseContext(ctx) {

        if (!ctx) {
            return;
        }

        ctx.currCourse = {};

        ctx.userData = {};
        ctx.enrollmentData = {};
        ctx.assignmentData = {};
        ctx.topics = {};

        ctx.accessData.length = 0;
        ctx.studentData.length = 0;
        ctx.instructorData.length = 0;
        ctx.submissionData.length = 0;
        ctx.topicEntries.length = 0;
        ctx.topicIDs.length = 0;

        ctx.teacherNames.length = 0;
        ctx.teacherEmails.length = 0;
    }

    // ==============================
    // Course context
    // ==============================

    function createCourseContext(courseID) {
        return {
            courseID: courseID,
            currCourse: {},
            userData: {},
            enrollmentData: {},
            assignmentData: {},
            accessData: [],
            studentData: [],
            instructorData: [],
            submissionData: [],
            topics: {},
            topicEntries: [],
            topicIDs: [],
            teacherNames: [],
            teacherEmails: [],
            emptyCourse: false
        };
    }

    function getEnrollmentByUserID(ctx, userID) {
        var ids = Object.keys(ctx.enrollmentData);

        for (var i = 0; i < ids.length; i++) {
            var enrollment = ctx.enrollmentData[ids[i]];

            if (
                String(enrollment.user_id) === String(userID) &&
                String(enrollment.course_id) === String(ctx.currCourse.course_id)
            ) {
                return enrollment;
            }
        }

        return null;
    }

    function addCourseDataToRecord(ctx, obj) {
        obj.sis_course_id = ctx.currCourse.sis_course_id;
        obj.course_code = ctx.currCourse.course_code;
        obj.course_id = ctx.currCourse.course_id;
        obj.course_name = ctx.currCourse.course_name;
        obj.enrollment_term_id = ctx.currCourse.enrollment_term_id;
        obj.quarter_name = ctx.currCourse.quarter_name || 'N/A';
        obj.section = ctx.currCourse.section || 'N/A';
        obj.short_course_code = ctx.currCourse.short_code || 'N/A';

        if (controls.rptType === 'at-risk' || controls.rptType === 'participation') {
            obj.teacher_name = ctx.currCourse.teacher_name;
            obj.teacher_email = ctx.currCourse.teacher_email;
            obj.assignments_due = ctx.currCourse.assignments_due;
        }

        if (controls.rptType === 'instructor') {
            obj.ttl_stdnts = ctx.currCourse.ttl_stdnts;
            obj.graded_ontime_pcnt = ctx.currCourse.graded_ontime_pcnt;
            obj.graded_late_pcnt = ctx.currCourse.graded_late_pcnt;
            obj.graded_none_pcnt = ctx.currCourse.graded_none_pcnt;
            obj.feedback_count = ctx.currCourse.feedback_count;
            obj.feedback_mean_length = ctx.currCourse.feedback_mean_length;
            obj.announcements = ctx.currCourse.announcements;
        }
    }

    // ==============================
    // Main async report workflow
    // ==============================

    async function setupReports(enrllTrm, srchBy, srchTrm) {
        try {
            document.body.style.cursor = 'wait';
            controls.emptyCourse = false;
            controls.aborted = false;
            abortController = new AbortController();

            controls.rptType = $('#capir_report_slct').children('option:selected').val();
            controls.combinedRpt = $("input[name='capir_report_opts']:checked").val() === 'true';
            controls.dlCrsOnly = $('#capir_dl_crs_chbx').prop('checked');
            controls.anonStdnts = $('#capir_anon_stdnt_chbx').prop('checked');

            var enrollTermID = enrllTrm > 0 ? '&enrollment_term_id=' + enrllTrm : '';
            var searchBy = srchBy === 'true' ? '' : '&search_by=teacher';
            var searchTrm = srchTrm.length > 0 ? '&search_term=' + encodeURIComponent(srchTrm) : '';

            var cURL =
                '/api/v1/accounts/' +
                controls.canvasAcct +
                '/courses?with_enrollments=true' +
                enrollTermID +
                searchTrm +
                searchBy +
                '&per_page=100';

            progressbar();

            var courseIDs = await getCourseIdsAsync(cURL);

            if (courseIDs.length === 0) {
                alert('No courses matched your search criteria. Refine your search and try again.');
                resetUI();
                return;
            }

            var pluralCrs = courseIDs.length > 1 ? 's' : '';
            var runScriptDlg =
                'The records from ' +
                courseIDs.length +
                ' course' +
                pluralCrs +
                ' will be processed. Continue?';

            if (!confirm(runScriptDlg)) {
                resetUI();
                return;
            }

            var courseContexts = await mapWithLimit(
                courseIDs,
                CONCURRENCY.COURSES,
                async function (courseID, index) {
                    controls.courseIndex = index;
                    progressbar(index, courseIDs.length);
                    return processCourseAsync(courseID);
                }
            );

            await outputReportsAsync(courseContexts);
        } catch (e) {
            errorHandler(e);
        }
    }

    async function getCourseIdsAsync(crsURL) {
        $('#capir_report_status').text('Getting course IDs...');

        var courses = await canvasFetchAllPages(crsURL);
        var courseIDs = [];

        courses.forEach(function (thisCourse) {
            var crsNameStr = thisCourse.course_code || '';
            var dlStatus = /-DL_/.test(crsNameStr);
            var crsAvlbl = thisCourse.workflow_state === 'available';
            var cncldStatus = /_SECX\d\d/.test(crsNameStr);
            var sndbxStatus = /^CCS_/.test(crsNameStr);

            if (controls.dlCrsOnly && !dlStatus) {
                return;
            }

            if (cncldStatus || sndbxStatus || !crsAvlbl) {
                console.log((thisCourse.name || thisCourse.course_code) + ' omitted.');
                controls.emptyCourse = true;
                return;
            }

            courseIDs.push(thisCourse.id);
        });

        controls.courseArray = courseIDs;
        controls.coursePending = courseIDs.length;

        return courseIDs;
    }

    async function processCourseAsync(courseID) {
        var ctx = createCourseContext(courseID);

        await loadCourseDataAsync(ctx);

        if (ctx.emptyCourse) {
            return ctx;
        }

        await Promise.all([
            loadUsersAsync(ctx),
            loadEnrollmentsAsync(ctx)
        ]);

        processEnrollmentsForContext(ctx);

        switch (controls.rptType) {
            case 'access':
                await loadAllUserAccessesAsync(ctx);
                processAccessesForContext(ctx);
                break;

            case 'at-risk':
            case 'participation':
                await Promise.all([
                    loadAllUserAccessesAsync(ctx),
                    loadSubmissionsAsync(ctx, false),
                    loadAssignmentsAsync(ctx)
                ]);

                processAccessesForContext(ctx);
                processStudentSubmissionsForContext(ctx);
                processAtRiskForContext(ctx);
                break;

            case 'final-grade':
                processFinalGradesForContext(ctx);
                break;

            case 'instructor':
                await Promise.all([
                    loadAllUserAccessesAsync(ctx),
                    loadSubmissionsAsync(ctx, true),
                    loadAssignmentsAsync(ctx)
                ]);

                processAccessesForContext(ctx);
                processGradingForContext(ctx);

                await Promise.all([
                    loadDiscussionActivityAsync(ctx),
                    countAnnouncementsAsync(ctx)
                ]);

                finalizeInstructorPresenceForContext(ctx);
                break;

            default:
                throw new Error('Unknown report type: ' + controls.rptType);
        }

        return ctx;
    }

    // ==============================
    // Canvas API loading functions
    // ==============================

    async function loadCourseDataAsync(ctx) {
        $('#capir_report_status').text('Getting course data...');

        var url = '/api/v1/courses/' + ctx.courseID + '?include[]=total_students';
        var page = await canvasFetchPage(url);
        var cdata = page.data;

        ctx.currCourse.sis_course_id = cdata.sis_course_id;
        ctx.currCourse.course_code = cdata.course_code;
        ctx.currCourse.course_id = cdata.id;
        ctx.currCourse.ttl_stdnts = cdata.total_students;
        ctx.currCourse.course_name = cdata.name ? cdata.name.replace(/[^\s]+\s/i, '') : '';
        ctx.currCourse.enrollment_term_id = cdata.enrollment_term_id;
        ctx.currCourse.quarter_name = firstRegexMatch(/^\d{4}\D{2}/, cdata.course_code, 'N/A');
        ctx.currCourse.section = firstRegexMatch(/SEC(\d+)/, cdata.course_code, 'N/A');
        ctx.currCourse.short_code = firstRegexMatch(/(?<=_).+(?=-)/, cdata.course_code, 'N/A');

        if (controls.rptType === 'at-risk' || controls.rptType === 'participation') {
            ctx.currCourse.discussions_due = 0;
            ctx.currCourse.assignments_due = 0;
        }

        if (controls.rptType === 'instructor') {
            ctx.currCourse.submissions_count = 0;
            ctx.currCourse.submissions_graded_ontime = 0;
            ctx.currCourse.submissions_graded_late = 0;
            ctx.currCourse.submissions_graded_none = 0;
            ctx.currCourse.graded_ontime_pcnt = 0;
            ctx.currCourse.graded_late_pcnt = 0;
            ctx.currCourse.graded_none_pcnt = 0;
            ctx.currCourse.feedback_count = 0;
            ctx.currCourse.feedback_mean_length = 0;
            ctx.currCourse.announcements = 0;
        }

        $('#capir_report_name').text(cdata.course_code);

        if (ctx.currCourse.ttl_stdnts === 0) {
            console.log(ctx.currCourse.course_code + ' - No students enrolled.');
            ctx.emptyCourse = true;
            controls.emptyCourse = true;
        }
    }

    async function loadUsersAsync(ctx) {
        $('#capir_report_status').text('Getting users data...');

        var uURL =
            '/api/v1/courses/' +
            ctx.currCourse.course_id +
            '/users?include[]=email';

        if (controls.rptType === 'instructor') {
            uURL += '&enrollment_type[]=teacher';
        }

        uURL += '&per_page=100';

        var users = await canvasFetchAllPages(uURL);

        users.forEach(function (user) {
            ctx.userData[user.id] = user;
        });
    }

    async function loadEnrollmentsAsync(ctx) {
        $('#capir_report_status').text('Getting enrollments data...');

        var eURL =
            '/api/v1/courses/' +
            ctx.currCourse.course_id +
            '/enrollments?per_page=100&include[]=current_points';

        if (controls.rptType === 'instructor') {
            eURL += '&role[]=TeacherEnrollment';
        }

        var enrollments = await canvasFetchAllPages(eURL);

        enrollments.forEach(function (enrollment) {
            if (String(enrollment.user_id) === '249004') {
                return;
            }

            ctx.enrollmentData[enrollment.id] = enrollment;
        });
    }

    async function loadAllUserAccessesAsync(ctx) {
        $('#capir_report_status').text('Getting user access data...');

        var userIDs = Object.keys(ctx.userData);

        await mapWithLimit(userIDs, CONCURRENCY.USER_ACCESS, async function (userID, index) {
            progressbar(index, userIDs.length);

            var aURL =
                '/courses/' +
                ctx.currCourse.course_id +
                '/users/' +
                userID +
                '/usage.json?per_page=100';

            var accesses = await canvasFetchAllPages(aURL);

            if (accesses.length === 0) {
                var enrollment = getEnrollmentByUserID(ctx, userID);

                if (enrollment) {
                    ctx.accessData.push(makeNoAccessRecord(enrollment));
                }

                return;
            }

            accesses.forEach(function (item) {
                var access = item.asset_user_access;

                if (!access) {
                    return;
                }

                if (!isAccessInReportingPeriod(access)) {
                    return;
                }

                ctx.accessData.push(access);
            });
        });
    }

    function makeNoAccessRecord(enrollment) {
        return {
            role: enrollment.role,
            readable_name: 'No accesses',
            total_activity_time: 0,
            view_score: 0,
            participate_score: 0,
            created_at: null,
            last_access: null,
            last_activity_at: null,
            action_level: 'none',
            asset_category: 'N/A',
            asset_class_name: 'N/A',
            user_id: enrollment.user_id
        };
    }

    function isAccessInReportingPeriod(access) {
        if (!reportingPeriodIsActive()) {
            return true;
        }

        var accessDate =
            access.last_access ||
            access.last_activity_at ||
            access.created_at;

        return dateIsInReportingPeriod(accessDate);
    }

    async function loadSubmissionsAsync(ctx, includeComments) {
        $('#capir_report_status').text('Getting submissions data...');
        var sURL = '/api/v1/courses/' + ctx.currCourse.course_id + '/students/submissions?student_ids[]=all&per_page=100';

        if (includeComments) {
            sURL += '&include[]=submission_comments';
        }

        ctx.submissionData = await canvasFetchAllPages(sURL);
    }

    async function loadAssignmentsAsync(ctx) {
        $('#capir_report_status').text('Getting assignments data...');

        var dURL = '/api/v1/courses/' + ctx.currCourse.course_id + '/assignments?per_page=100';

        var assignments = await canvasFetchAllPages(dURL);
        var assignmentCount = 0;
        var discussionCount = 0;

        assignments.forEach(function (assignment) {
            var dueMS = new Date(assignment.due_at).getTime();
            var inScope;

            if (!assignment.published) {
                return;
            }

            if (!reportingPeriodIsActive()) {
                // No reporting period specified, include assignments due before now
                inScope = dueMS < controls.nowDateMS;
            } else {
                // Reporting period specified, include only assignments due inside the period
                inScope = dateIsInReportingPeriod(dueMS);
            }

            if (!inScope) {
                return;
            }

            ctx.assignmentData[assignment.id] = assignment;
            assignmentCount++;

            if (assignment.submission_types && assignment.submission_types[0] === 'discussion_topic') {
                discussionCount++;
            }
        });

        ctx.currCourse.assignments_due = assignmentCount;
        ctx.currCourse.discussions_due = discussionCount;
    }

    async function loadDiscussionActivityAsync(ctx) {
        $('#capir_report_status').text('Getting discussion topics...');

        var tURL =
            '/api/v1/courses/' +
            ctx.currCourse.course_id +
            '/discussion_topics?per_page=100';

        var topics = await canvasFetchAllPages(tURL);

        topics.forEach(function (topic) {
            ctx.topics[topic.id] = topic;

            if (topic.anonymous_state == null) {
                ctx.topicIDs.push(topic.id);
            }
        });

        $('#capir_report_status').text('Getting discussion topic entries...');

        await mapWithLimit(ctx.topicIDs, CONCURRENCY.TOPICS, async function (topicID, index) {
            progressbar(index, ctx.topicIDs.length);

            var eURL =
                '/api/v1/courses/' +
                ctx.currCourse.course_id +
                '/discussion_topics/' +
                topicID +
                '/view?per_page=100';

            var page = await canvasFetchPage(eURL);
            collectTopicEntries(ctx, page.data);
        });

        processTopicEntriesForContext(ctx);
    }

    function collectTopicEntries(ctx, eData) {
        if (!eData || !Array.isArray(eData.view)) {
            return;
        }

        eData.view.forEach(function (entry) {
            if (entry.hasOwnProperty('deleted') || !entry.hasOwnProperty('message')) {
                return;
            }

            ctx.topicEntries.push(entry);

            if (entry.replies && Array.isArray(entry.replies)) {
                entry.replies.forEach(function (reply) {
                    if (reply.hasOwnProperty('deleted') || !reply.hasOwnProperty('message')) {
                        return;
                    }

                    ctx.topicEntries.push(reply);
                });
            }
        });
    }

    async function countAnnouncementsAsync(ctx) {
        $('#capir_report_status').text('Counting instructor announcements...');

        var nURL = '/api/v1/courses/' + ctx.currCourse.course_id + '/discussion_topics?only_announcements=true&per_page=100';

        var announcements = await canvasFetchAllPages(nURL);

        ctx.currCourse.announcements = announcements.filter(function (announcement) {
            return (
                announcement.posted_at != null &&
                dateIsInReportingPeriod(announcement.posted_at)
            );
        }).length;
    }

    // ==============================
    // Processing functions
    // ==============================

    function processEnrollmentsForContext(ctx) {
        $('#capir_report_status').text('Processing enrollment data...');

        getObjectValues(ctx.enrollmentData).forEach(function (enrollment) {
            var role = enrollment.role || '';
            role = role.replace(/Enrollment/i, '');
            role = role.replace(/^Ta$/, 'TA');

            enrollment.role = role;
            enrollment.page_views = 0;
            enrollment.home_page_views = 0;

            if (controls.rptType === 'at-risk' || controls.rptType === 'participation') {
                if (role === 'Student') {
                    enrollment.submitted = 0;
                    enrollment.assignments_late = 0;
                    enrollment.max_days_late = 0;
                    enrollment.assignments_missing = 0;
                    enrollment.max_days_missing = 0;
                    enrollment.discussion_posts = 0;
                }

                if (role === 'Teacher') {
                    var teacherUser = ctx.userData[enrollment.user_id];

                    if (teacherUser && teacherUser.name && !/^NU-/.test(teacherUser.name)) {
                        ctx.teacherNames.push(teacherUser.name);
                        ctx.teacherEmails.push(teacherUser.email);
                    }
                }
            }

            if (controls.rptType === 'instructor') {
                enrollment.discussion_posts = 0;
                enrollment.post_chars = 0;
                enrollment.post_mean_length = 0;
                enrollment.last_post_date = 0;
            }
        });

        ctx.currCourse.teacher_email = ctx.teacherEmails.join(';');
        ctx.currCourse.teacher_name = ctx.teacherNames.join(', ');

        if (controls.anonStdnts) {
            batchAnonymizeStudentsForContext(ctx);
        }
    }

    function batchAnonymizeStudentsForContext(ctx) {
        getObjectValues(ctx.enrollmentData).forEach(function (enrollment) {
            var userID = enrollment.user_id;

            if (enrollment.role !== 'Student') {
                return;
            }

            if (!ctx.userData[userID] || ctx.userData[userID].anon_name) {
                return;
            }

            ctx.userData[userID].anon_name = makeAnonymousStudentName();
        });
    }

    function makeAnonymousStudentName() {
        var firstNames = [
            'Alabaster', 'Almond', 'Ash', 'Beige', 'Black', 'Blue', 'Bronze',
            'Brown', 'Cobalt', 'Coral', 'Cyan', 'Emerald', 'Gray', 'Green',
            'Indigo', 'Lavender', 'Olive', 'Orange', 'Pink', 'Purple',
            'Red', 'Rose', 'Ruby', 'Saffron', 'Sapphire', 'Violet',
            'White', 'Yellow'
        ];

        var lastNames = [
            'Acorn', 'Anise', 'Artichoke', 'Basil', 'Bean', 'Beet',
            'Broccoli', 'Cabbage', 'Carrot', 'Celery', 'Chard', 'Coriander',
            'Cucumber', 'Dill', 'Fennel', 'Garlic', 'Ginger', 'Kale',
            'Lemon', 'Lentils', 'Mushroom', 'Onion', 'Oregano', 'Paprika',
            'Parsley', 'Pea', 'Pepper', 'Potato', 'Pumpkin', 'Radish',
            'Rosemary', 'Sage', 'Squash', 'Thyme', 'Tomato', 'Turnip',
            'Wasabi'
        ];

        var first = firstNames[Math.floor(Math.random() * firstNames.length)];
        var last = lastNames[Math.floor(Math.random() * lastNames.length)];

        return first + ' ' + last;
    }

    function processAccessesForContext(ctx) {
        $('#capir_report_status').text('Processing user access data...');

        ctx.accessData.forEach(function (access, index) {
            progressbar(index, ctx.accessData.length);

            var enrollment = getEnrollmentByUserID(ctx, access.user_id);

            if (enrollment) {
                if (controls.rptType === 'access') {
                    access.user_role = enrollment.role;
                    access.total_activity_time = enrollment.total_activity_time;
                    addCourseDataToRecord(ctx, access);
                }

                if (controls.rptType === 'at-risk' || controls.rptType === 'instructor') {
                    var mediaRegex = RegExp('(.jpg|.png|.svg|.mp(3|4|g))$', 'i');
                    var mediaFile = mediaRegex.test(access.readable_name || '');

                    if (!mediaFile) {
                        enrollment.page_views += access.view_score || 0;
                    }
                    if (access.readable_name === 'Course Home') {
                        enrollment.home_page_views = access.view_score || 0;
                    }

                    if (controls.rptDateStart > 0 && access.last_access) {
                        var thisLastAccessMS = new Date(access.last_access).getTime();
                        var currentLastAccessMS = new Date(enrollment.last_activity_at || 0).getTime();

                        if (thisLastAccessMS > currentLastAccessMS) {
                            enrollment.last_activity_at = access.last_access;
                        }
                    }
                }
            } else {
                access.user_role = 'Unenrolled';
            }

            ctx.accessData[index] = access;
        });
    }

    function processStudentSubmissionsForContext(ctx) {
        $('#capir_report_status').text('Processing submissions data...');

        ctx.submissionData.forEach(function (submission, index) {
            progressbar(index, ctx.submissionData.length);

            var enrollment = getEnrollmentByUserID(ctx, submission.user_id);
            var assignment = ctx.assignmentData[submission.assignment_id];

            // Confirm that the submission is assocated with the correct enrollment
            if (!enrollment || !assignment) {
                return;
            }

            // If there is a submission date, it must be inside the reporting period.
            // Missing/unsubmitted work may not have submitted_at, so do not exclude it here.
            if (
                reportingPeriodIsActive() &&
                submission.submitted_at &&
                !dateIsInReportingPeriod(submission.submitted_at)
            ) {
                return;
            }

            if (
                submission.missing === false &&
                submission.workflow_state !== 'unsubmitted' &&
                submission.score !== 0
            ) {
                enrollment.submitted++;
            }

            if (
                submission.submission_type === 'discussion_topic' &&
                submission.workflow_state !== 'unsubmitted' &&
                submission.score !== 0
            ) {
                enrollment.discussion_posts++;
            }

            if (submission.late === true) {
                enrollment.max_days_late = Math.max(
                    enrollment.max_days_late,
                    submission.seconds_late || 0
                );
                enrollment.assignments_late++;
            }

            if (
                submission.missing === true ||
                (submission.score === 0 && submission.submitted_at == null)
            ) {
                enrollment.max_days_missing = Math.max(
                    enrollment.max_days_missing,
                    submission.seconds_late || 0
                );
                enrollment.assignments_missing++;
            }
        });
    }


    function processAtRiskForContext(ctx) {
        $('#capir_report_status').text('Identifying students for report...');

        getObjectValues(ctx.enrollmentData).forEach(function (enrollment) {
            if (enrollment.role !== 'Student') {
                return;
            }

            var submissions = enrollment.submitted || 0;
            var time = enrollment.total_activity_time || 0;
            var posts = enrollment.discussion_posts || 0;
            var late = enrollment.assignments_late || 0;
            var missing = enrollment.assignments_missing || 0;
            var score = enrollment.grades ? enrollment.grades.current_score : null;

            if (controls.rptType === 'at-risk') {
                var lowScore = typeof score === 'number' && score < controls.atRisk.scoreRaw;

                if (
                    late > controls.atRisk.late ||
                    missing > controls.atRisk.mssg ||
                    time === controls.atRisk.time ||
                    posts === controls.atRisk.posts ||
                    lowScore ||
                    submissions === controls.atRisk.sbmssn
                ) {
                    enrollment.current_score_status = lowScore ? 'Low' : 'OK';
                    enrollment.discussion_posts = ' ' + posts + ' / ' + ctx.currCourse.discussions_due;
                    enrollment.submitted = ' ' + submissions + ' / ' + ctx.currCourse.assignments_due;

                    addCourseDataToRecord(ctx, enrollment);
                    ctx.studentData.push(enrollment);
                }
            }

            if (controls.rptType === 'participation' && submissions === 0) {
                enrollment.submitted = ' ' + submissions + ' / ' + ctx.currCourse.assignments_due;

                addCourseDataToRecord(ctx, enrollment);
                ctx.studentData.push(enrollment);
            }
        });
    }

    // FINAL GRADES: Extract the final course score, letter grade, and gradebook URL for each student enrollment
    // The final score is based on current_score and the letter grade is based on current_grade (letter grade, if one has been assigned)
    // current_score and current_grade values may differ from final_score and final_grade values,
    // but current values are displayed in the Gradebook Total column and passed or entered into CAESAR
    function processFinalGradesForContext(ctx) {
        $('#capir_report_status').text('Processing final grades...');

        getObjectValues(ctx.enrollmentData).forEach(function (enrollment) {
            if (
                enrollment.type !== 'StudentEnrollment' ||
                !enrollment.grades ||
                typeof enrollment.grades.current_score === 'undefined'
            ) {
                return;
            }

            enrollment.score_current = enrollment.grades.current_score;
            enrollment.grade_current = enrollment.grades.current_grade;
            enrollment.grade_url = enrollment.grades.html_url;

            addCourseDataToRecord(ctx, enrollment);
            ctx.studentData.push(enrollment);
        });
    }

    // INSTRUCTOR PRESENCE: Count assignments graded on-time, late or ungraded after 7 days, also get the mean number of feedback characters for each graded assignment
    function processGradingForContext(ctx) {
        $('#capir_report_status').text('Calculating grading and feedback metrics...');

        var feedbackLen = 0;

        ctx.submissionData.forEach(function (submission, index) {
            progressbar(index, ctx.submissionData.length);

            var assignment = ctx.assignmentData[submission.assignment_id];

            if (!submission || !assignment) {
                return;
            }

            if (
                reportingPeriodIsActive() &&
                submission.workflow_state === 'graded' &&
                !dateIsInReportingPeriod(submission.graded_at)
            ) {
                return;
            }

            var dueDateMS = new Date(assignment.due_at).getTime();
            var submitDateMS = new Date(submission.submitted_at).getTime();
            var gradedDateMS = new Date(submission.graded_at).getTime();

            if (dueDateMS > controls.nowDateMS || submission.workflow_state === 'unsubmitted') {
                return;
            }

            ctx.currCourse.submissions_count++;

            if (submission.workflow_state === 'graded') {
                var gradeAnchorMS = submission.late === true ? submitDateMS : dueDateMS;
                var gradedWithinInterval = gradedDateMS - gradeAnchorMS <= controls.lateGradingIntvl;

                if (gradedWithinInterval) {
                    ctx.currCourse.submissions_graded_ontime++;
                } else {
                    ctx.currCourse.submissions_graded_late++;
                }
            }

            if (
                submission.workflow_state === 'submitted' &&
                (
                    (submission.late === false && controls.nowDateMS - dueDateMS > controls.lateGradingIntvl) ||
                    (submission.late === true && controls.nowDateMS - submitDateMS > controls.lateGradingIntvl)
                )
            ) {
                ctx.currCourse.submissions_graded_none++;
            }

            if (Array.isArray(submission.submission_comments)) {
                submission.submission_comments.forEach(function (comment) {
                    var author = ctx.userData[comment.author_id];

                    if (!author) {
                        return;
                    }

                    ctx.currCourse.feedback_count++;

                    if (comment.comment) {
                        feedbackLen += comment.comment.length;
                    }
                });
            }
        });

        var total = ctx.currCourse.submissions_count;

        if (total > 0) {
            ctx.currCourse.graded_none_pcnt = roundTwo((ctx.currCourse.submissions_graded_none / total) * 100);
            ctx.currCourse.graded_late_pcnt = roundTwo((ctx.currCourse.submissions_graded_late / total) * 100);
            ctx.currCourse.graded_ontime_pcnt = roundTwo((ctx.currCourse.submissions_graded_ontime / total) * 100);
        }

        ctx.currCourse.feedback_mean_length =
            ctx.currCourse.feedback_count > 0? Math.round(feedbackLen / ctx.currCourse.feedback_count) : 0;
    }

    function processTopicEntriesForContext(ctx) {
        $('#capir_report_status').text('Processing discussion topic entries...');

        ctx.topicEntries.forEach(function (entry, index) {
            progressbar(index, ctx.topicEntries.length);

            var enrollment = getEnrollmentByUserID(ctx, entry.user_id);

            if (!enrollment) {
                return;
            }

            var entryDateMS = new Date(entry.updated_at).getTime();

            if (!dateIsInReportingPeriod(entryDateMS)) {
                return;
            }

            enrollment.discussion_posts++;

            var cleanMessage = (entry.message || '').replace(/<(.|\n)*?>/g, '');
            enrollment.post_chars += cleanMessage.length;
            enrollment.post_mean_length = enrollment.post_chars / enrollment.discussion_posts;

            var lastPostMS = new Date(enrollment.last_post_date || 0).getTime();

            if (entryDateMS > lastPostMS) {
                enrollment.last_post_date = entry.updated_at;
            }
        });
    }

    function finalizeInstructorPresenceForContext(ctx) {
        getObjectValues(ctx.enrollmentData).forEach(function (enrollment) {
            addCourseDataToRecord(ctx, enrollment);
            ctx.instructorData.push(enrollment);
        });
    }

    // ==============================
    // CSV output
    // ==============================

    async function outputReportsAsync(courseContexts) {
        $('#capir_report_status').text('Compiling report...');

        if (controls.combinedRpt) {
            var merged = mergeCourseContexts(courseContexts);
            outputReport(merged, null);
            destroyCourseContext(merged);
            merged = null;
        } else {
            courseContexts.forEach(function (ctx) {
                if (!ctx.emptyCourse) {
                    outputReport(ctx, ctx.currCourse.course_code);
                }
                destroyCourseContext(ctx)
            });
        }
        courseContexts.length = 0;
        resetUI();
    }

    function mergeCourseContexts(contexts) {
        var merged = createCourseContext('combined');

        contexts.forEach(function (ctx) {
            Object.assign(merged.userData, ctx.userData);
            merged.accessData = merged.accessData.concat(ctx.accessData);
            merged.studentData = merged.studentData.concat(ctx.studentData);
            merged.instructorData = merged.instructorData.concat(ctx.instructorData);
        });

        return merged;
    }

    function outputReport(ctx, courseCode) {
        var csv = createCSVFromContext(ctx);

        if (!csv) {
            throw new Error('Problem creating report');
        }

        var blob = new Blob([csv], {
            type: 'text/csv;charset=utf-8'
        });

        saveAs(blob, buildReportName(courseCode));
    }

    function buildReportName(courseCode) {
        var reportName = '';

        if (courseCode) {
            reportName = courseCode + ' ';
        } else {
            reportName =
                $('#capir_term_slct option:selected').val() == 0
                    ? ''
                    : $('#capir_term_slct option:selected').text() + ' ';

            reportName +=
                $('#capir_srch_inpt').val() === ''
                    ? ''
                    : $('#capir_srch_inpt').val().toUpperCase() + ' ';
        }

        reportName += $('#capir_report_slct option:selected').text();

        if (controls.rptDateStartTxt !== '') {
            var rptDatesConcat = controls.rptDateStartTxt + ' - ' + controls.rptDateEndTxt;
            var rptDatesClean = rptDatesConcat.replace(/\//g, '-');
            reportName += ' ' + rptDatesClean.replace(/20(?=\d{2})/g, '');
        }

        return reportName + ' Report.csv';
    }

    function createCSVFromContext(ctx) {
        var fields = getCSVFields();

        if (controls.anonStdnts) {
            fields.splice(0, 2, {
                name: 'Name',
                src: 'u.name'
            });
        } else {
            fields.splice(2, 0, {
                name: 'Sortable Name',
                src: 'u.sortable_name'
            });
        }

        if (controls.rptType === 'participation') {
            fields.splice(4, 11);
            fields.splice(
                9,
                0,
                { name: 'Canvas Course ID', src: 'a.course_id' },
                { name: 'SIS Course ID', src: 'a.sis_course_id' },
                { name: 'Canvas Term ID', src: 'a.enrollment_term_id' },
                { name: 'Submitted / Due', src: 'e.submitted' },
            );
            fields.push({
                name: 'Name',
                src: 'u.name'
            });
        }

        var canSIS = Object.keys(ctx.userData).some(function (id) {
            return typeof ctx.userData[id].sis_user_id !== 'undefined' && ctx.userData[id].sis_user_id;
        });

        var CRLF = '\r\n';
        var hdr = [];

        fields.forEach(function (field) {
            if (typeof field.sis === 'undefined' || (field.sis && canSIS)) {
                var name = headingNoSpaces ? field.name.replace(/\s/g, '') : field.name;
                hdr.push(csvEscape(name));
            }
        });

        var csv = hdr.join(',') + CRLF;
        var currArray = [];

        if (controls.rptType === 'access') {
            currArray = ctx.accessData;
        } else if (controls.rptType === 'instructor') {
            currArray = ctx.instructorData;
        } else {
            currArray = ctx.studentData;
        }

        currArray.forEach(function (item) {
            if (
                controls.rptType === 'access' &&
                !showViewStudent &&
                item.asset_category === 'roster' &&
                item.asset_class_name === 'student_enrollment'
            ) {
                return;
            }

            var userId = item.user_id;
            var user = ctx.userData[userId];

            if (!user) {
                return;
            }

            var row = [];

            fields.forEach(function (field) {
                if (typeof field.sis !== 'undefined' && field.sis && !canSIS) {
                    return;
                }

                var fieldInfo = field.src.split('.');
                var value = '';

                if (fieldInfo[0] === 'u') {
                    if (
                        controls.anonStdnts &&
                        fieldInfo[1] === 'name' &&
                        (item.user_role === 'Student' || item.role === 'Student')
                    ) {
                        value = user.anon_name || user.name || '';
                    } else {
                        value = user[fieldInfo[1]];
                    }
                } else {
                    value = item[fieldInfo[1]];

                    if (fieldInfo[1] === 'total_activity_time' && controls.rptType === 'access') {
                        value = item.readable_name === 'Course Home' ? item[fieldInfo[1]] : '';
                    }
                }

                if (value === undefined || value === null) {
                    value = '';
                }

                if (field.fmt) {
                    value = formatValue(value, field.fmt);
                }

                row.push(csvEscape(value));
            });

            csv += row.join(',') + CRLF;
        });

        return csv;
    }

    function getCSVFields() {
        if (controls.rptType === 'final-grade') {
            return [
                { name: 'User ID', src: 'u.id' },
                { name: 'Login ID', src: 'u.login_id' },
                { name: 'Final Score', src: 'e.score_current' },
                { name: 'Final Letter Grade', src: 'e.grade_current' },
                { name: 'Quarter', src: 'e.quarter_name' },
                { name: 'Section', src: 'e.section' },
                { name: 'Short Course Code', src: 'e.short_course_code' },
                { name: 'Course Name', src: 'e.course_name' },
                { name: 'Student Grades Page', src: 'e.grade_url' }
            ];
        }

        if (controls.rptType === 'at-risk' || controls.rptType === 'participation') {
            return [
                { name: 'User ID', src: 'u.id' },
                { name: 'Login ID', src: 'u.login_id' },
                { name: 'Email', src: 'u.email' },
                { name: 'Total Hours Active', src: 'e.total_activity_time', fmt: 'hours' },
                { name: 'Last Activity', src: 'e.last_activity_at', fmt: 'date' },
                { name: 'Home Page Views', src: 'e.home_page_views' },
                { name: 'Total Page Views', src: 'e.page_views' },
                { name: 'Submitted / Due', src: 'e.submitted' },
                { name: 'Late Assignments', src: 'e.assignments_late' },
                { name: 'Max. Days Late', src: 'e.max_days_late', fmt: 'days' },
                { name: 'Missing Assignments', src: 'e.assignments_missing' },
                { name: 'Max. Days Missing', src: 'e.max_days_missing', fmt: 'days' },
                { name: 'Current Score', src: 'e.current_score_status' },
                { name: 'Discussion Posts / Due', src: 'e.discussion_posts' },
                { name: 'Quarter', src: 'e.quarter_name' },
                { name: 'Section', src: 'e.section' },
                { name: 'Short Course Code', src: 'e.short_course_code' },
                { name: 'Course Name', src: 'e.course_name' },
                { name: 'Full Course Code', src: 'e.course_code' },
                { name: 'Instructor Name', src: 'e.teacher_name' },
                { name: 'Instructor Email', src: 'e.teacher_email' },
                { name: 'Student Course Enrollment Page', src: 'e.html_url' }
            ];
        }

        if (controls.rptType === 'instructor') {
            return [
                { name: 'User ID', src: 'u.id' },
                { name: 'Login ID', src: 'u.login_id' },
                { name: 'Email', src: 'u.email' },
                { name: 'Total Hours Active', src: 'e.total_activity_time', fmt: 'hours' },
                { name: 'Last Activity', src: 'e.last_activity_at', fmt: 'date' },
                { name: 'Home Page Views', src: 'e.home_page_views' },
                { name: 'Total Page Views', src: 'e.page_views' },
                { name: 'Announcements', src: 'e.announcements' },
                { name: 'Discussion Posts', src: 'e.discussion_posts' },
                { name: 'Last Post Date', src: 'e.last_post_date', fmt: 'date' },
                { name: 'Mean Post Chars', src: 'e.post_mean_length', fmt: 'integer' },
                { name: 'Graded On-time %', src: 'e.graded_ontime_pcnt' },
                { name: 'Graded Late %', src: 'e.graded_late_pcnt' },
                { name: 'Grades Overdue %', src: 'e.graded_none_pcnt' },
                { name: 'Assignment Feedback', src: 'e.feedback_count' },
                { name: 'Mean Feedback Chars', src: 'e.feedback_mean_length', fmt: 'integer' },
                { name: 'Enrollment', src: 'e.ttl_stdnts' },
                { name: 'Quarter', src: 'e.quarter_name' },
                { name: 'Section', src: 'e.section' },
                { name: 'Short Course Code', src: 'e.short_course_code' },
                { name: 'Course Name', src: 'e.course_name' },
                { name: 'Full Course Code', src: 'e.course_code' },
                { name: 'Instructor Course Enrollment Page', src: 'e.html_url' }
            ];
        }

        return [
            { name: 'User ID', src: 'u.id' },
            { name: 'Login ID', src: 'u.login_id' },
            { name: 'Role', src: 'a.user_role' },
            { name: 'Total Hours Active', src: 'a.total_activity_time', fmt: 'hours' },
            { name: 'Asset Title', src: 'a.readable_name' },
            { name: 'Views', src: 'a.view_score' },
            { name: 'Participations', src: 'a.participate_score' },
            { name: 'First Access', src: 'a.created_at', fmt: 'date' },
            { name: 'Last Access', src: 'a.last_access', fmt: 'date' },
            { name: 'Action', src: 'a.action_level' },
            { name: 'Asset Code', src: 'a.asset_code' },
            { name: 'Asset Group Code', src: 'a.asset_group_code' },
            { name: 'Quarter', src: 'a.quarter_name' },
            { name: 'Section', src: 'a.section' },
            { name: 'Short Course Code', src: 'a.short_course_code' },
            { name: 'Course Name', src: 'a.course_name' },
            { name: 'Full Course Code', src: 'a.course_code' },
            { name: 'Canvas Course ID', src: 'a.course_id' },
            { name: 'SIS Course ID', src: 'a.sis_course_id' },
            { name: 'Canvas Term ID', src: 'a.enrollment_term_id' },
            { name: 'Asset Category', src: 'a.asset_category' },
            { name: 'Asset Class', src: 'a.asset_class_name' }
        ];
    }

    function formatValue(value, fmt) {
        switch (fmt) {
            case 'date':
                return excelDate(value);
            case 'hours':
                return timeHours(value);
            case 'days':
                return timeDays(value);
            case 'integer':
                return integerVal(value);
            default:
                return value;
        }
    }

    function csvEscape(value) {
        if (value === undefined || value === null) {
            return '';
        }

        value = String(value);

        if (value.indexOf('"') > -1) {
            value = value.replace(/"/g, '""');
        }

        if (value.indexOf(',') > -1 || value.indexOf('"') > -1 || value.indexOf('\n') > -1 || value.indexOf('\r') > -1) {
            value = '"' + value + '"';
        }

        if (/^[=+\-@]/.test(value)) {
            value = "'" + value;
        }

        return value;
    }

    function excelDate(timestamp) {
        if (!timestamp) {
            return '';
        }

        var dt = new Date(timestamp);

        if (isNaN(dt.getTime())) {
            return '';
        }

        return (
            dt.getFullYear() +
            '-' +
            pad(1 + dt.getMonth()) +
            '-' +
            pad(dt.getDate()) +
            ' ' +
            pad(dt.getHours()) +
            ':' +
            pad(dt.getMinutes()) +
            ':' +
            pad(dt.getSeconds())
        );

        function pad(n) {
            return n < 10 ? '0' + n : n;
        }
    }

    function timeDays(seconds) {
        if (!seconds || isNaN(seconds)) {
            return '';
        }

        return (seconds / 86400).toFixed(2);
    }

    function timeHours(seconds) {
        if (!seconds || isNaN(seconds)) {
            return '';
        }

        return (seconds / 3600).toFixed(2);
    }

    function integerVal(floatVal) {
        if (!floatVal || isNaN(floatVal)) {
            return '';
        }

        return Math.round(floatVal);
    }

    // ==============================
    // UI functions
    // ==============================

    function resetUI() {
        if ($('#capir_progress_dialog').length && $('#capir_progress_dialog').dialog('isOpen')) {
            $('#capir_progress_dialog').dialog('close');
        }
        controls.aborted = false;
        controls.courseArray = [];
        controls.courseIndex = 0;
        controls.coursePending = -1;
        controls.rptDateStart = 0;
        controls.rptDateEnd = 0;
        controls.rptDateStartTxt = '';
        controls.rptDateEndTxt = '';

        document.body.style.cursor = 'default';

        $('#capir_access_report').one('click', reportOptionsDlg);

        if (controls.emptyCourse) {
            alert('Courses labeled as cancelled, unpublished, sandbox, or with no students enrolled have been omitted. See Console for details.');
        }
    }

    function progressbar(current, total) {
        try {
            if (typeof total === 'undefined' || typeof current === 'undefined') {
                if ($('#capir_progress_dialog').length === 0) {
                    $('body').append('<div id="capir_progress_dialog"></div>');
                    $('#capir_progress_dialog').append('<div id="capir_report_name" style="font-size: 12pt; font-weight:bold"></div>');
                    $('#capir_progress_dialog').append('<div id="capir_progressbar"></div>');
                    $('#capir_progress_dialog').append('<div id="capir_report_status" style="font-size: 12pt; text-align: center"></div>');

                    $('#capir_progress_dialog').dialog({
                        title: 'Fetching Canvas Data',
                        autoOpen: false,
                        buttons: [
                            {
                                text: 'Cancel',
                                click: function () {
                                    $(this).dialog('close');
                                    abortAll();
                                    $('#capir_access_report').one('click', reportOptionsDlg);
                                }
                            }
                        ]
                    });

                    $('.ui-dialog-titlebar-close').remove();
                }

                if ($('#capir_progress_dialog').dialog('isOpen')) {
                    $('#capir_progress_dialog').dialog('close');
                } else {
                    $('#capir_progressbar').progressbar({
                        value: false
                    });

                    $('#capir_progress_dialog').dialog('open');
                }
            } else if (!controls.aborted) {
                var val = current > 0 && total > 0 ? Math.round((100 * current) / total) : false;
                $('#capir_progressbar').progressbar('option', 'value', val);
            }
        } catch (e) {
            errorHandler(e);
        }
    }

    function dateOptionsDlgResult(result) {
        if (!result) {
            controls.rptDateStart = 0;
            controls.rptDateEnd = 0;
            controls.rptDateStartTxt = '';
            controls.rptDateEndTxt = '';

            $('#capir_rprt_prd_chbx').prop('checked', false);
            $('#capir_date_range_p').text('');
            return;
        }

        var startText = $('#capir_start_date_txt').val();
        var endText = $('#capir_end_date_txt').val();

        var startDate = new Date(startText);
        var endDate = new Date(endText);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            alert('Enter valid start and end dates for the reporting period.');
            return false;
        }

        if (endDate < startDate) {
            alert('The end date must occur after the start date.');
            return false;
        }

        controls.rptDateStartTxt = startText;
        controls.rptDateEndTxt = endText;
        controls.rptDateStart = startDate.setHours(0, 0, 0, 0);
        controls.rptDateEnd = endDate.setHours(23, 59, 59, 999);

        $('#capir_date_range_p').text(controls.rptDateStartTxt + ' - ' + controls.rptDateEndTxt);
    }

    function hideDatePickers() {
        console.log('hidedatepickers fired');


        $('#capir_start_date_txt').datepicker.blur();
        $('#capir_end_date_txt').datepicker.blur();
        console.log($(document.activeElement).prop("tagName"));
        $(document.activeElement).blur();
        console.log($(document.activeElement).prop("id"));

        $('#capir_prtcptn_dts_dialog').trigger('click');
    }

    function showDateOptionsDlg() {
        try {
            if ($('#capir_prtcptn_dts_dialog').length === 0) {
                $('body').append('<div id="capir_prtcptn_dts_dialog"></div>');
                $('#capir_prtcptn_dts_dialog').append('<p style="font-size: 1em">Select the range of dates for reporting.</p>');
                $('#capir_prtcptn_dts_dialog').append('<form id="capir_prtcptn_dts_frm"></form>');
                $('#capir_prtcptn_dts_frm').append('<fieldset id="capir_prtcptn_dts_fldst"></fieldset>');
                $('#capir_prtcptn_dts_fldst').append('<label for="capir_start_date_txt">Start Date:</label>');
                $('#capir_prtcptn_dts_fldst').append('<input type="text" id="capir_start_date_txt" name="capir_start_date_txt">');
                $('#capir_start_date_txt').datepicker();
                $('#capir_prtcptn_dts_fldst').append('<label for="capir_end_date_txt">End Date:</label>');
                $('#capir_prtcptn_dts_fldst').append('<input type="text" id="capir_end_date_txt" name="capir_end_date_txt">');
                $('#capir_end_date_txt').datepicker({
                    onSelect: function() {
                        console.log("Datepicker select.");
                        $('#capir_prtcptn_dts_dialog').select();
                    }
                });
                $('#capir_prtcptn_dts_dialog').dialog({
                    title: 'Specify Reporting Period',
                    autoOpen: false,
                    modal: true,
                    buttons: {
                        OK: function () {

                            var startDate = new Date($('#capir_start_date_txt').val());
                            var endDate = new Date($('#capir_end_date_txt').val());

                            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                                alert('Enter valid start and end dates for the reporting period.');
                                return false;
                            }

                            if (endDate < startDate) {
                                alert('The end date must occur after the start date.');
                                return false;
                            }

                            $(this).dialog('close');
                            dateOptionsDlgResult(true);
                        },
                        Cancel: function () {
                            $(this).dialog('close');
                            dateOptionsDlgResult(false);
                        }
                    }
                });
            }

            $('#capir_prtcptn_dts_dialog').dialog('open');
        } catch (e) {
            errorHandler(e);
        }
    }

    function enableReportOptionsDlgOK() {

        if (
            ($('#capir_term_slct').val() != 0 || $('#capir_srch_inpt').val() !== '') &&
            $('#capir_report_slct').val() != 0
        ) {
            $('#capir_term_slct')
                .closest('.ui-dialog')
                .find("button:contains('OK')")
                .removeAttr('disabled')
                .removeClass('ui-state-disabled');
        } else {
            $('#capir_term_slct')
                .closest('.ui-dialog')
                .find("button:contains('OK')")
                .prop('disabled', true)
                .addClass('ui-state-disabled');
        }
    }

    function reportOptionsDlg() {
        try {
            if ($('#capir_options_frm').length === 0) {
                $('body').append('<div id="capir_options_dialog"></div>');
                $('#capir_options_dialog').append('<form id="capir_options_frm"></form>');
                $('#capir_options_frm').append('<fieldset id="capir_options_fldst"></fieldset>');

                $('#capir_options_fldst').append('<select id="capir_term_slct"></select>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<input type="radio" name="capir_srch_rdo" id="coursename" value="true" checked="checked">');
                $('#capir_options_fldst').append('<label for="coursename">&nbsp;Course Name</label>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<input type="radio" name="capir_srch_rdo" id="instructorname" value="false">');
                $('#capir_options_fldst').append('<label for="instructorname">&nbsp;Instructor Name</label>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<label for="capir_srch_inpt">Search text:</label>');
                $('#capir_options_fldst').append('<input type="text" id="capir_srch_inpt" name="capir_srch_inpt">');
                $('#capir_options_fldst').append('<hr>');
                $('#capir_options_fldst').append('<select id="capir_report_slct"></select>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<input type="radio" name="capir_report_opts" id="single" value="true" checked="checked">');
                $('#capir_options_fldst').append('<label for="single">&nbsp;Single report (all selected courses)</label>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<input type="radio" name="capir_report_opts" id="multiple" value="false">');
                $('#capir_options_fldst').append('<label for="multiple">&nbsp;Multiple reports (individual courses)</label>');
                $('#capir_options_fldst').append('<hr>');
                $('#capir_options_fldst').append('<input type="checkbox" id="capir_dl_crs_chbx" name="capir_dl_crs_chbx" value="true" checked>');
                $('#capir_options_fldst').append('<label for="capir_dl_crs_chbx">&nbsp;Online courses only</label>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<input type="checkbox" id="capir_anon_stdnt_chbx" name="capir_anon_stdnt_chbx" value="true" checked>');
                $('#capir_options_fldst').append('<label for="capir_anon_stdnt_chbx">&nbsp;Anonymize students</label>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<input type="checkbox" id="capir_rprt_prd_chbx" name="capir_rprt_prd_chbx" value="true">');
                $('#capir_options_fldst').append('<label for="capir_rprt_prd_chbx">&nbsp;Specify reporting period</label>');
                $('#capir_options_fldst').append('<br>');
                $('#capir_options_fldst').append('<span id="capir_date_range_p" style="font-size: 1em; margin-left: 1.75em"></span>');

                REPORT_TERMS.forEach(function (term) {
                    $('#capir_term_slct').append(
                        $('<option>', {
                            value: term.val,
                            text: term.txt
                        })
                    );
                });

                REPORT_TYPES.forEach(function (report) {
                    $('#capir_report_slct').append(
                        $('<option>', {
                            value: report.val,
                            text: report.txt
                        })
                    );
                });

                $('#capir_term_slct').change(enableReportOptionsDlgOK);
                $('#capir_srch_inpt').change(enableReportOptionsDlgOK);

                $('#capir_report_slct').change(function () {
                    var selected = $(this).children('option:selected').val();

                    if (selected === 'participation') {
                        $('#capir_anon_stdnt_chbx').prop('checked', false).prop('disabled', true);
                        $('#capir_rprt_prd_chbx').prop('checked', true).prop('disabled', false);
                        showDateOptionsDlg();
                    } else if (selected === 'at-risk' || selected === 'instructor') {
                        $('#capir_anon_stdnt_chbx').prop('checked', false).prop('disabled', true);
                        $('#capir_rprt_prd_chbx').prop('disabled', false);
                    } else if (selected === 'access') {
                        $('#capir_anon_stdnt_chbx').prop('disabled', false);
                        clearReportDates();
                        $('#capir_rprt_prd_chbx').prop('disabled', true).prop('checked', false);
                    } else if (selected === 'final-grade') {
                        $('#capir_anon_stdnt_chbx').prop('checked', false).prop('disabled', true);
                        clearReportDates();
                        $('#capir_rprt_prd_chbx').prop('disabled', true).prop('checked', false);
                    } else {
                        $('#capir_anon_stdnt_chbx').prop('disabled', false);
                        $('#capir_rprt_prd_chbx').prop('disabled', false).prop('checked', false);
                        clearReportDates();
                    }

                    enableReportOptionsDlgOK();
                });

                $('#capir_rprt_prd_chbx').change(function () {
                    clearReportDates();

                    if ($(this).is(':checked')) {
                        showDateOptionsDlg();
                    }
                });

                $('#capir_options_dialog').dialog({
                    title: 'Select Report Options',
                    modal: true,
                    autoOpen: false,
                    buttons: {
                        OK: function () {
                            $(this).dialog('close');

                            var enrllTrmSelct = $('#capir_term_slct option:selected').val();
                            var srchByChecked = $("input[name='capir_srch_rdo']:checked").val();
                            var srchTermsStr = $('#capir_srch_inpt').val();

                            setupReports(enrllTrmSelct, srchByChecked, srchTermsStr);
                        },
                        Cancel: function () {
                            $(this).dialog('close');
                            $('#capir_access_report').one('click', reportOptionsDlg);
                        }
                    }
                });

                $('.ui-dialog-titlebar-close').remove();

                $('#capir_term_slct')
                    .closest('.ui-dialog')
                    .find("button:contains('OK')")
                    .prop('disabled', true)
                    .addClass('ui-state-disabled');
            }

            $('#capir_options_dialog').dialog('open');
        } catch (e) {
            errorHandler(e);
        }
    }

    function clearReportDates() {
        controls.rptDateStart = 0;
        controls.rptDateEnd = 0;
        controls.rptDateStartTxt = '';
        controls.rptDateEndTxt = '';
        $('#capir_date_range_p').text('');
    }

    function addReportsLink() {
        if ($('#capir_access_report').length === 0) {
            $('#section-tabs').append(
                '<li class="section">' +
                    '<a id="capir_access_report" style="color:#f92626; cursor:pointer">' +
                        'Custom API Reports' +
                        '<span class="screenreader-only">Custom API Reports</span>' +
                    '</a>' +
                '</li>'
            );

            $('#capir_access_report').one('click', reportOptionsDlg);
        }
    }

    function setDialogZvalues() {
    $('<style>')
        .text(`
    .ui-dialog {
        z-index: 1000000 !important;
    }
    .ui-widget-overlay {
        z-index: 999999 !important;
    }
    #ui-datepicker-div {
       z-index: 1000050 !important;
    }
`)
     .appendTo('head');

    }

    $(document).ready(function () {
        addReportsLink();
        setDialogZvalues();
    });

})(jQuery);